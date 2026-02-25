import EventEmitter from "events";
import DeltaExchange from "../exchanges/deltaExchange.js";
import BinanceExchange from "../exchanges/BinanceExchange.js";
import symbolMapper from "../utils/symbolMapper.js";
import redisService from "../services/redisService.js";
import mongoService from "../services/mongoService.js";
import config from "../config/config.js";
import tpTrackerService from "../services/tpTrackerService.js";

// Phase 2 imports
import positionSizer from "./positionSizer.js";
import liquidityAnalyzer from "./liquidityAnalyzer.js";
import profitCalculator from "./profitCalculator.js";

// Phase 3 imports
import orderExecutor from "./orderExecutor.js";

// Phase 4 & 5 imports
import TradeMonitor from "../monitors/tradeMonitor.js";
import exitManager from "./exitManager.js";
import deltaAPI from "../services/deltaAPI.js";
import pi42API from "../services/pi42API.js";
import coindcxAPI from "../services/coindcxAPI.js";

/**
 * Arbitrage Engine - Phase 1, 2, 3, 4 & 5 Implementation
 * Phase 1: Token selection, timing verification, and threshold checking
 * Phase 2: Position sizing, liquidity analysis, and profit calculation
 * Phase 3: Order execution on both exchanges with mandatory checks
 * Phase 4: Real-time trade monitoring with quantity checks and flip detection
 * Phase 5: Exit logic with funding credit verification and emergency exits
 */
class ArbitrageEngine extends EventEmitter {
  constructor() {
    super();

    // Exchange instances
    this.deltaExchange = new DeltaExchange();
    this.coindcxExchange = new BinanceExchange();

    // State
    this.isRunning = false;
    this.isExecuting = false;
    this.hasActivePosition = false;

    // Thresholds
    this.TH1 = config.trading.primaryThreshold;
    this.TH2 = config.trading.secondaryThreshold;

    this.fundingTimeWindow = config.trading.fundingTimeWindowSeconds;
    this.preFundingWindowMinutes = config.trading.preFundingWindowMinutes || 5; // NEW
    this.preFundingWindowMs = this.preFundingWindowMinutes * 60 * 1000;
    this.orderCooldownMs = config.trading.orderCooldownMinutes * 60 * 1000;
    this.paperTradingMode = config.trading.paperTradingMode;
    this.phase2Enabled = config.trading.phase2Enabled || true;
    this.phase3Enabled = config.trading.phase3Enabled || true;

    this.opportunities = new Map();

    this.orderbookDepth = config.trading.orderbookDepth;
    this.lastDecision = null;

    this.tradeMonitor = null;
    this.activeTrade = null;
    this.lastTradeExecutionTime = null;

    // Bind event handlers
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for exchange updates
   */
  setupEventHandlers() {
    // Delta updates
    this.deltaExchange.on("update", async (data) => {
      await this.handleDeltaUpdate(data);
    });

    this.deltaExchange.on("connected", () => {
      console.log("📊 Delta Exchange connected and streaming data");
    });

    // Pi42 updates
    this.coindcxExchange.on("batchUpdate", async () => {
      await this.processPotentialOpportunities();
    });

    this.coindcxExchange.on("connected", () => {
      console.log("📊 Coindcx Exchange connected and streaming data");
    });
  }

  /**
   * Setup Trade Monitor event handlers (Phase 4 & 5)
   */
  setupTradeMonitorHandlers() {
    if (!this.tradeMonitor) return;

    // Quantity mismatch event
    this.tradeMonitor.on("quantityMismatch", async (data) => {
      console.error("\n❌ QUANTITY MISMATCH DETECTED");
      console.error(`   Delta Quantity: ${data.deltaQty}`);
      console.error(`   Coindcx Quantity: ${data.coindcxQty}`);
      console.error(`   Difference: ${data.differencePct.toFixed(2)}%`);
      await this.handleEmergencyExit(data);
    });

    // Flip detection event
    this.tradeMonitor.on("flip", async (data) => {
      console.log("data", data);
      console.error("\n❌ FUNDING RATE FLIP DETECTED");
      console.error(`   Current Funding Diff: ${data.fundingDiff}%`);
      console.error(`   Threshold: ${data.threshold}%`);
    });

    // Emergency exit event (from either quantity mismatch or flip)
    this.tradeMonitor.on("emergencyExit", async (exitData) => {
      console.log("\n🚨 EMERGENCY EXIT EVENT RECEIVED");
      console.log(`   Reason: ${exitData.reason}`);

      await this.handleEmergencyExit(exitData);
    });

    this.tradeMonitor.on("normalExit", async (exitData) => {
      console.log("\n⏰ NORMAL EXIT EVENT RECEIVED");
      console.log(`   Reason: ${exitData.reason}`);

      await this.handleNormalExit(exitData);
    });
    // Trade registered event
    this.tradeMonitor.on("tradeRegistered", (trade) => {
      console.log("✅ Trade registered for monitoring");
    });

    this.tradeMonitor.deltaMonitor.on("position", (data) => {
      this.handlePositionChange("delta", data);
    });

    this.tradeMonitor.coindcxMonitor.on("position", (data) => {
      this.handlePositionChange("coindcx", data);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔧 FIXED: Position size extraction with correct field names
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get Delta position size (using correct field: 'size')
   */
  getDeltaPositionSize(position) {
    if (!position) return 0;
    // Delta uses 'size' field (number of contracts)
    const size = Math.abs(parseFloat(position.size || 0));
    const contractValue = parseFloat(position.product?.contract_value || 1);
    return size * contractValue;
  }

  /**
   * Get CoinDCX position size (using correct fields)
   */
  getCoindcxPositionSize(position) {
    if (!position) return 0;
    // CoinDCX uses 'size', 'active_pos', or 'positionAmount'
    const size = parseFloat(
      position.size || position.active_pos || position.positionAmount || 0,
    );
    return Math.abs(size);
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔧 FIXED: Position change handler with correct field detection
  // ═══════════════════════════════════════════════════════════════

  handlePositionChange(exchange, data) {
    const { type, position } = data;

    console.log(`\n📊 Position Change Detected (${exchange.toUpperCase()})`);
    console.log(`   Type: ${type}`);

    // 🔴 FIXED: Handle delete/close/liquidated events
    if (
      type === "delete" ||
      type === "closed" ||
      type === "liquidated" ||
      type === "zero_size"
    ) {
      console.log(`   ⚠️ Position CLOSED/DELETED (type: ${type})`);

      // Update position lock status
      this.updatePositionLockStatus();
      return;
    }

    // 🔴 FIXED: Use correct field names for each exchange
    let hasPosition = false;
    let positionSize = 0;

    if (exchange === "delta") {
      // Delta uses 'size' field, NOT 'positionAmt'
      positionSize = this.getDeltaPositionSize(position);
      hasPosition = positionSize > 0;

      console.log(`   Symbol: ${position.product_symbol}`);
      console.log(`   Size: ${position.size} (value: ${positionSize})`);
      console.log(`   Side: ${position.side}`);
    } else if (exchange === "coindcx") {
      // CoinDCX uses 'size', 'active_pos', or 'positionAmount'
      positionSize = this.getCoindcxPositionSize(position);
      hasPosition = positionSize > 0;

      console.log(`   Symbol: ${position.symbol || position.pair}`);
      console.log(`   Size: ${positionSize}`);
      console.log(`   Side: ${position.side}`);
    }

    console.log(`   Has Position: ${hasPosition ? "YES ✅" : "NO ❌"}`);

    // 🔴 FIXED: If size is 0, treat as position closed
    if (!hasPosition) {
      console.log(`   ⚠️ Position size is 0 - treating as CLOSED`);
    }

    // Update position lock status
    this.updatePositionLockStatus();
  }

  /**
   * Update position lock status based on current positions
   */
  updatePositionLockStatus() {
    // 🔴 FIXED: Use correct field names
    const hasDeltaPosition =
      this.tradeMonitor?.latestDeltaPosition &&
      this.getDeltaPositionSize(this.tradeMonitor.latestDeltaPosition) > 0;

    const hasCoindcxPosition =
      this.tradeMonitor?.latestCoindcxPosition &&
      this.getCoindcxPositionSize(this.tradeMonitor.latestCoindcxPosition) > 0;

    const shouldLock = hasDeltaPosition || hasCoindcxPosition;

    console.log(`\n🔍 Position Lock Check:`);
    console.log(
      `   Delta Position: ${hasDeltaPosition ? "Active ✅" : "None ❌"}`,
    );
    console.log(
      `   CoinDCX Position: ${hasCoindcxPosition ? "Active ✅" : "None ❌"}`,
    );

    if (shouldLock !== this.hasActivePosition) {
      this.hasActivePosition = shouldLock;

      console.log(
        `\n🔒 POSITION LOCK STATUS CHANGED: ${shouldLock ? "LOCKED ❌" : "UNLOCKED ✅"}`,
      );

      if (!shouldLock) {
        console.log("   ✅ All positions closed - Bot can execute new trades");
      } else {
        console.log(
          "   ❌ Position(s) active - Bot will NOT execute new trades",
        );
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔧 FIXED: Startup position check with correct field names
  // ═══════════════════════════════════════════════════════════════

  async checkStartupPositions() {
    console.log("\n🔍 Checking for existing positions at startup...");
    console.log("━".repeat(60));

    // Wait for initial position data to load
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 🔴 FIXED: Use correct field names
    const deltaPosition = this.tradeMonitor?.latestDeltaPosition;
    const coindcxPosition = this.tradeMonitor?.latestCoindcxPosition;

    const hasDeltaPosition =
      deltaPosition && this.getDeltaPositionSize(deltaPosition) > 0;
    const hasCoindcxPosition =
      coindcxPosition && this.getCoindcxPositionSize(coindcxPosition) > 0;

    console.log(`📊 Startup Position Status:`);

    console.log(
      `   Delta: ${hasDeltaPosition ? "✅ ACTIVE POSITION FOUND" : "⭕ No position"}`,
    );
    if (hasDeltaPosition) {
      console.log(`      Symbol: ${deltaPosition.product_symbol}`);
      console.log(`      Size: ${deltaPosition.size}`);
      console.log(`      Side: ${deltaPosition.side}`);
      console.log(`      Entry Price: $${deltaPosition.entry_price}`);
      console.log(`      Mark Price: $${deltaPosition.mark_price}`);
      console.log(`      Liq Price: $${deltaPosition.liquidation_price}`);
    }

    console.log(
      `   CoinDCX: ${hasCoindcxPosition ? "✅ ACTIVE POSITION FOUND" : "⭕ No position"}`,
    );
    if (hasCoindcxPosition) {
      console.log(
        `      Symbol: ${coindcxPosition.symbol || coindcxPosition.pair}`,
      );
      console.log(
        `      Size: ${this.getCoindcxPositionSize(coindcxPosition)}`,
      );
      console.log(`      Side: ${coindcxPosition.side}`);
      console.log(`      Avg Price: $${coindcxPosition.avg_price}`);
      console.log(`      Mark Price: $${coindcxPosition.mark_price}`);
      console.log(`      Leverage: ${coindcxPosition.leverage}x`);
    }

    const hasAnyPosition = hasDeltaPosition || hasCoindcxPosition;
    this.hasActivePosition = hasAnyPosition;

    console.log(
      `\n🔒 Position Lock: ${this.hasActivePosition ? "LOCKED ❌" : "UNLOCKED ✅"}`,
    );

    if (this.hasActivePosition) {
      console.log("   ⚠️  STARTUP POSITIONS DETECTED");
      console.log("   → Bot will NOT execute new trades");
      console.log("   → Monitoring existing positions for exit");
    } else {
      console.log("   ✅ No existing positions found");
      console.log("   → Bot ready to execute new trades");
    }

    console.log("━".repeat(60));
  }

  /**
   * Start the arbitrage engine
   */
  async start() {
    console.log(
      "🚀 Starting Funding Rate Arbitrage Engine - Phase 1, 2, 3, 4 & 5",
    );
    console.log("━".repeat(50));

    try {
      // Connect to Redis
      await redisService.connect();
      // Connect to MongoDB
      await mongoService.connect();

      // Connect to exchanges
      this.deltaExchange.connect();
      this.coindcxExchange.connect();

      // Initialize and start Trade Monitor (Phase 4)
      if (!this.paperTradingMode) {
        console.log("\n🔄 Initializing Trade Monitor (Phase 4)...");
        this.tradeMonitor = new TradeMonitor(
          this.deltaExchange,
          this.coindcxExchange,
        );
        this.setupTradeMonitorHandlers();
        await this.tradeMonitor.start();

        await this.checkStartupPositions();
      }

      this.isRunning = true;

      console.log("━".repeat(70));
      console.log("Arbitrage Engine started successfully");
      console.log(`Primary Threshold (TH1): ${this.TH1}%`);
      console.log(`Secondary Threshold (TH2): ${this.TH2}%`);
      console.log(`Funding Time Window: ${this.fundingTimeWindowSeconds}s`);
      console.log(
        `Pre-Funding Trigger Window: < ${this.preFundingWindowMinutes} minutes`,
      );
      console.log(`Phase 2 Enabled: ${this.phase2Enabled}`);
      console.log(`Phase 3 Enabled: ${this.phase3Enabled}`);
      console.log(`Paper Trading Mode: ${this.paperTradingMode}`);
      console.log(
        `Trade Monitoring: ${!this.paperTradingMode ? "ENABLED" : "DISABLED"}`,
      );
      console.log(`Order Cooldown: ${this.orderCooldownMs} minutes`);
      console.log(
        `Current Position Lock: ${this.hasActivePosition ? "LOCKED" : "UNLOCKED"}`,
      );
      console.log("━".repeat(70));

      this.emit("started");
    } catch (error) {
      console.error("❌ Failed to start arbitrage engine:", error);
      throw error;
    }
  }

  /**
   * Handle Delta exchange updates
   */
  async handleDeltaUpdate(data) {
    // Cache in Redis
    await redisService.storeFundingData("delta", data.symbol, data);

    // Periodically persist to MongoDB (every 10th update to reduce load)
    // if (Math.random() < 0.1) {
    //   await mongoService.storeFundingRate('delta', data.symbol, data);
    // }
  }

  /**
   * Process potential arbitrage opportunities
   * This is the main Phase 1 logic - BIDIRECTIONAL SEARCH
   */
  async processPotentialOpportunities() {
    if (!this.isRunning || this.isExecuting || this.hasActivePosition) {
      console.log(
        `\nScanning blocked → Executing: ${this.isExecuting} | Active Position: ${this.hasActivePosition}`,
      );
      return;
    }
    const coindcxTopSymbols =
      this.coindcxExchange.getSymbolsSortedByFundingRate();
    const deltaTopSymbols = this.deltaExchange.getSymbolsSortedByFundingRate();
    // const coindcxTopSymbols = this.coindcxExchange.getSymbolsSortedByFundingRate();

    // console.log("DeltaTopSymbols", deltaTopSymbols)
    // console.log("CoindcxTopSymbols", coindcxTopSymbols)
    const validDeltaTop = deltaTopSymbols.filter(
      (item) => item && item.symbol && typeof item.symbol === "string",
    );
    const validCoindcxTop = coindcxTopSymbols.filter(
      (item) => item && item.symbol && typeof item.symbol === "string",
    );

    if (validDeltaTop.length <= 1 && validCoindcxTop.length <= 1) {
      console.log("Waiting for valid funding data from both exchanges...");
      return;
    }

    console.log(`\nScanning Top 15 from Delta & Coindcx for opportunities...`);

    const qualifiedOpportunities = [];
    const checkedPairs = new Set();

    // Bidirectional evaluation
    for (const deltaData of deltaTopSymbols) {
      // console.log("delatdat", deltaData)
      const coindcxSymbol = symbolMapper.deltaToPi42(deltaData.symbol);
      if (
        !coindcxSymbol ||
        checkedPairs.has(`${deltaData.symbol}-${coindcxSymbol}`)
      )
        continue;
      checkedPairs.add(`${deltaData.symbol}-${coindcxSymbol}`);

      const opportunity = await this.evaluateOpportunityFromDelta(
        deltaData,
        this.coindcxExchange.getFundingData(coindcxSymbol),
      );
      if (opportunity) qualifiedOpportunities.push(opportunity);
    }

    console.log("Pass delata");
    for (const coindcxData of coindcxTopSymbols) {
      const deltaSymbol = symbolMapper.pi42ToDelta(coindcxData.symbol);

      // console.log(deltaSymbol)
      if (
        !deltaSymbol ||
        checkedPairs.has(`${deltaSymbol}-${coindcxData.symbol}`)
      )
        continue;
      checkedPairs.add(`${deltaSymbol}-${coindcxData.symbol}`);

      const opportunity = await this.evaluateOpportunityFromCoindcx(
        coindcxData,
        this.deltaExchange.getFundingData(deltaSymbol),
      );
      if (opportunity) qualifiedOpportunities.push(opportunity);
    }

    console.log("Pass Coindcx");

    if (qualifiedOpportunities.length === 0) {
      console.log(
        `No opportunities found within ${this.preFundingWindowMinutes}-minute pre-funding window`,
      );
      return;
    }

    // Add priority score: higher diff + closer to funding = higher priority

    qualifiedOpportunities.forEach((opportunity) => {
      opportunity.priorityScore =
        opportunity.fundingDiff +
        5000000 / Math.max(opportunity.timeToFundingMs, 60000);
    });

    qualifiedOpportunities.sort((a, b) => b.priorityScore - a.priorityScore);

    const bestOpportunity = qualifiedOpportunities[0];
    const minutesToFunding = (bestOpportunity.timeToFundingMs / 60000).toFixed(
      1,
    );

    console.log(
      `\nFound ${qualifiedOpportunities.length} qualified opportunities`,
    );
    console.log(`BEST OPPORTUNITY: ${bestOpportunity.token}`);
    console.log(`   Funding Diff: ${bestOpportunity.fundingDiff.toFixed(4)}%`);
    console.log(`   Time to Funding: ${minutesToFunding} minutes`);
    console.log(
      `   Priority Score: ${bestOpportunity.priorityScore.toFixed(0)}`,
    );

    await this.handleOpportunity(bestOpportunity);
  }

  /**
   * Evaluate opportunity starting from Delta data
   * @param {Object} deltaData - Delta exchange funding data
   * @returns {Object|null} - Opportunity object or null
   */
  async evaluateOpportunityFromDelta(deltaData) {
    const deltaSymbol = deltaData.symbol;
    const coindcxSymbol = symbolMapper.deltaToPi42(deltaSymbol);

    if (!coindcxSymbol) return null;

    const coindcxData = this.coindcxExchange.getFundingData(coindcxSymbol);
    if (!coindcxData) return null;

    return this.evaluateOpportunity(deltaData, coindcxData);
  }

  /**
   * Evaluate opportunity starting from Pi42 data
   * @param {Object} pi42Data - Pi42 exchange funding data
   * @returns {Object|null} - Opportunity object or null
   */
  async evaluateOpportunityFromCoindcx(coindcxData) {
    const coindcxSymbol = coindcxData.symbol;
    const deltaSymbol = symbolMapper.pi42ToDelta(coindcxSymbol);

    if (!deltaSymbol) return null;

    const deltaData = this.deltaExchange.getFundingData(deltaSymbol);
    if (!deltaData) return null;

    return this.evaluateOpportunity(deltaData, coindcxData);
  }

  /**
   * Evaluate a potential arbitrage opportunity
   * Implements Phase 1: Token selection & timing
   *
   * @param {Object} deltaData - Delta exchange funding data
   * @param {Object} pi42Data - Pi42 exchange funding data
   * @returns {Object|null} - Opportunity object or null
   */
  async evaluateOpportunity(deltaData, binanceData) {
    // console.log(deltaData, binanceData)
    const deltaSymbol = deltaData.symbol;
    const binanceSymbol = binanceData.symbol;

    console.log(
      `🔎 Evaluating pair: Delta ${deltaSymbol} & Binance ${binanceSymbol}`,
    );

    const FR_EX1 = deltaData.fundingRate;
    const FT_EX1_ts = deltaData.nextFundingTime;
    const FR_EX2 = binanceData.fundingRate;
    const FT_EX2_ts = binanceData.nextFundingTime;
    const deltaNextFundingTime = deltaData.nextFundingTime;
    const coindcxNextFundingTime = binanceData.nextFundingTime;

    console.log(
      `   Delta FR: ${FR_EX1}%, Next FT: ${FT_EX1_ts ? new Date(FT_EX1_ts).toLocaleString() : "N/A"}`,
    );
    console.log(
      `   Binance  FR: ${FR_EX2}%, Next FT: ${FT_EX2_ts ? new Date(FT_EX2_ts).toLocaleString() : "N/A"}`,
    );
    // Validate funding rates exist
    if (FR_EX1 === null || FR_EX2 === null) {
      return null;
    }

    // Step 5: Verify funding times align (if available)
    let timeDiff = null;

    if (FT_EX1_ts !== null && FT_EX2_ts !== null) {
      timeDiff = Math.abs(FT_EX1_ts - FT_EX2_ts) / 1000; // Convert to seconds

      if (timeDiff > this.fundingTimeWindow) {
        // Funding times don't align
        return null;
      }
    } else {
      // Both exchanges should have funding times
      // If not, skip this opportunity
      return null;
    }

    // Step 6: Order by absolute funding rate
    let FR_first, FR_second, exchange_first, exchange_second;

    if (Math.abs(FR_EX1) >= Math.abs(FR_EX2)) {
      FR_first = FR_EX1;
      FR_second = FR_EX2;
      exchange_first = "delta";
      exchange_second = "binance";
    } else {
      FR_first = FR_EX2;
      FR_second = FR_EX1;
      exchange_first = "binance";
      exchange_second = "delta";
    }

    // Step 7: Calculate funding rate difference
    const diff = this.calculateFundingDifference(FR_first, FR_second);

    console.log(`   Funding Rate Diff: ${diff}%`);

    const now = Date.now();
    const timeToDeltaFunding = deltaNextFundingTime - now;
    const timeToCoindcxFunding = coindcxNextFundingTime - now;
    const timeToFundingMs = Math.min(timeToDeltaFunding, timeToCoindcxFunding);

    if (timeToFundingMs > this.preFundingWindowMs || timeToFundingMs < 0) {
      console.log(
        `   ${(timeToFundingMs / 60000).toFixed(1)} min to funding → Outside ${this.preFundingWindowMinutes}-min window → Skipped`,
      );
      return null;
    }

    // Step 8: Check thresholds
    const thresholdResult = this.checkThresholds(diff);

    console.log(
      `   Threshold Check: ${thresholdResult.passed ? "PASSED" : "NOT PASSED"}`,
    );

    if (!thresholdResult.passed) {
      // Threshold not met
      return null;
    }

    // Create opportunity object
    const opportunity = {
      token: deltaSymbol,
      binanceSymbol: binanceSymbol,
      timestamp: Date.now(),
      timeToFundingMs: timeToFundingMs,
      priorityScore: 0, // will be set later

      // Funding rates
      FR_delta: FR_EX1,
      FR_binance: FR_EX2,
      FR_first,
      FR_second,
      exchange_first,
      exchange_second,

      // Funding times
      FT_delta: FT_EX1_ts,
      FT_binance: FT_EX2_ts,
      timeDiff,
      timingVerified: FT_EX1_ts !== null && FT_EX2_ts !== null,

      // Threshold check
      fundingDiff: diff,
      threshold: thresholdResult.threshold,
      thresholdType: thresholdResult.type,

      // Prices
      price_delta: deltaData.markPrice,
      price_binance: binanceData.markPrice,

      // Phase
      phase: 1,
      // direction: absDelta > absCoindcx ? 'LONG_DELTA_SHORT_COINCX' : 'LONG_COINCX_SHORT_DELTA',
      status: "qualified",
    };

    return opportunity;
  }

  /**
   * Calculate funding rate difference based on signs
   *
   * @param {number} FR_first - First funding rate (larger absolute)
   * @param {number} FR_second - Second funding rate
   * @returns {number} - Absolute difference
   */
  calculateFundingDifference(FR_first, FR_second) {
    const sign_first = Math.sign(FR_first);
    const sign_second = Math.sign(FR_second);

    if (sign_first === sign_second) {
      // Both same sign: diff = abs(FR_first) - abs(FR_second)
      return Math.abs(FR_first) - Math.abs(FR_second);
    } else {
      // Opposite signs: diff = abs(FR_first) + abs(FR_second)
      return Math.abs(FR_first) + Math.abs(FR_second);
    }
  }

  /**
   * Check if funding difference meets thresholds
   *
   * @param {number} diff - Funding rate difference (in %)
   * @returns {Object} - { passed: boolean, threshold: number, type: string }
   */
  checkThresholds(diff) {
    if (diff >= this.TH1) {
      console.log(`   Threshold Check: PASSED (Primary TH1: ${this.TH1}%)`);
      return {
        passed: true,
        threshold: this.TH1,
        type: "primary",
      };
    } else if (diff >= this.TH2) {
      console.log(`   Threshold Check: PASSED (Secondary TH2: ${this.TH2}%)`);
      return {
        passed: true,
        threshold: this.TH2,
        type: "secondary",
      };
    } else {
      console.log(`   Threshold Check: NOT PASSED (Diff: ${diff}%)`);
      return {
        passed: false,
        threshold: null,
        type: null,
      };
    }
  }

  /**
   * Handle a valid arbitrage opportunity
   *
   * @param {Object} opportunity - Opportunity object
   */
  async handleOpportunity(opportunity) {
    // Prevent overlapping executions
    if (this.isExecuting) {
      console.log(
        `⚠️ Skipping opportunity for ${opportunity.token}: Currently executing another trade.`,
      );
      return;
    }

    // CRITICAL: Block new trades if we still have an open position from previous trade
    if (this.hasActivePosition) {
      console.log(
        `\n🚫 BLOCKED: Active position exists for previous trade → Skipping ${opportunity.token}`,
      );
      return;
    }

    // SET EXECUTION LOCK IMMEDIATELY to prevent race conditions
    // This must be set BEFORE any await operations to prevent duplicate executions
    this.isExecuting = true;
    console.log("🔒 Execution lock acquired");

    const opportunityId = `${opportunity.token}_${opportunity.timestamp}`;

    console.log("\n" + "=".repeat(60));
    console.log("🎯 PHASE 1: ARBITRAGE OPPORTUNITY DETECTED");
    console.log("=".repeat(60));
    console.log(
      `Token:           ${opportunity.token} / ${opportunity.binanceSymbol}`,
    );
    console.log(`Funding Diff:    ${opportunity.fundingDiff.toFixed(4)}%`);
    console.log(
      `Threshold:       ${opportunity.threshold}% (${opportunity.thresholdType})`,
    );
    console.log(`Delta FR:        ${opportunity.FR_delta.toFixed(4)}%`);
    console.log(`Binance FR:         ${opportunity.FR_binance.toFixed(4)}%`);
    console.log(`Time Diff:       ${opportunity.timeDiff.toFixed(2)}s`);
    console.log(
      `Next Funding:    ${new Date(opportunity.FT_binance).toLocaleString()}`,
    );
    console.log(
      `Delta Funding:   ${opportunity.FT_delta ? new Date(opportunity.FT_delta).toLocaleString() : "N/A"}`,
    );
    console.log(
      `Binance Funding:    ${opportunity.FT_binance ? new Date(opportunity.FT_binance).toLocaleString() : "N/A"}`,
    );
    console.log("=".repeat(60));

    // Phase 2: Evaluate profitability (position sizing, etc.)
    if (this.phase2Enabled) {
      const phase2Result = await this.evaluatePhase2(opportunity);

      // 🎯 SAVE TP TO MONGODB (even if trade rejected)
      if (phase2Result.positionSize && phase2Result.positionSize.tp) {
        try {
          await tpTrackerService.saveTP({
            token: opportunity.token,
            deltaSymbol: opportunity.token,
            coindcxSymbol: opportunity.binanceSymbol,
            deltaTP: phase2Result.positionSize.tp.deltaTP,
            coindcxTP: phase2Result.positionSize.tp.coindcxTP,
            deltaSide: phase2Result.positionSize.tp.deltaSide,
            coindcxSide: phase2Result.positionSize.tp.coindcxSide,
            fundingDiff: opportunity.fundingDiff,
            spreadPercent:
              phase2Result.positionSize.spreadValidation?.priceSpread,
            nextFundingTime: opportunity.FT_binance,
            timeToFundingMs: opportunity.timeToFundingMs,
            status: phase2Result.canExecute ? "active" : "rejected",
            rejectionReason: phase2Result.canExecute
              ? null
              : phase2Result.reason,
          });
          console.log(`✅ TP saved to MongoDB for frontend display`);
        } catch (error) {
          console.error(`⚠️ Failed to save TP to MongoDB:`, error.message);
        }
      }

      if (!phase2Result.canExecute) {
        console.log(
          `\n❌ PHASE 2: Opportunity rejected - ${phase2Result.reason}\n`,
        );

        // Store rejected opportunity
        await mongoService.storeOpportunity({
          ...opportunity,
          phase2Result,
          status: "rejected_phase2",
        });

        // Release execution lock
        this.isExecuting = false;
        console.log("🔓 Execution lock released (Phase 2 rejection)");
        return;
      }

      // Add Phase 2 data to opportunity
      opportunity.phase2 = phase2Result;
    }

    // Store in memory and Redis
    this.opportunities.set(opportunityId, opportunity);
    await redisService.storeOpportunity(opportunityId, opportunity);

    // Phase 3: Real order execution
    let executionResult = null;

    if (this.phase3Enabled && !this.paperTradingMode) {
      // Check cooldown period
      if (this.lastTradeExecutionTime) {
        const timeSinceLastTrade = Date.now() - this.lastTradeExecutionTime;
        const cooldownRemaining = this.orderCooldownMs - timeSinceLastTrade;

        if (cooldownRemaining > 0) {
          const minutesRemaining = Math.ceil(cooldownRemaining / 60000);
          console.log(
            `\n⏳ COOLDOWN ACTIVE: ${minutesRemaining} minute(s) remaining`,
          );
          console.log(
            `   Last trade executed: ${new Date(this.lastTradeExecutionTime).toLocaleString()}`,
          );
          console.log(
            `   Next trade allowed: ${new Date(this.lastTradeExecutionTime + this.orderCooldownMs).toLocaleString()}`,
          );
          console.log(`   Skipping execution for ${opportunity.token}\n`);

          opportunity.status = "skipped_cooldown";
          await mongoService.storeOpportunity(opportunity);

          // Release execution lock
          this.isExecuting = false;
          console.log("🔓 Execution lock released (Cooldown skip)");
          return;
        } else {
          console.log(
            `✅ Cooldown period expired. Ready to execute new trade.`,
          );
        }
      }

      try {
        console.log(
          "\n🚀 Proceeding to Phase 3: Order Execution...",
          opportunity,
        );

        // Get fresh funding data right before execution
        const deltaFundingData = this.deltaExchange.getFundingData(
          opportunity.token,
        );
        const coindcxFundingData = this.coindcxExchange.getFundingData(
          opportunity.binanceSymbol,
        );

        if (!deltaFundingData || !coindcxFundingData) {
          console.error("❌ Cannot execute: Fresh funding data not available");
        } else {
          // Execute the arbitrage trade
          executionResult = await orderExecutor.executeArbitrageTrade(
            opportunity,
            deltaFundingData,
            coindcxFundingData,
          );

          // Attach result
          opportunity.phase3 = executionResult;

          if (executionResult.success) {
            console.log(
              "\n✅ PHASE 3: Orders executed successfully on both exchanges!",
            );

            // 🎯 MARK TP AS EXECUTED IN MONGODB
            try {
              await tpTrackerService.markAsExecuted(opportunity.token);
              console.log(`✅ TP marked as executed in MongoDB`);
            } catch (error) {
              console.error(`⚠️ Failed to mark TP as executed:`, error.message);
            }

            // Update cooldown timer
            this.lastTradeExecutionTime = Date.now();
            console.log(
              `⏱️  Trade execution timestamp recorded: ${new Date(this.lastTradeExecutionTime).toLocaleString()}`,
            );
            console.log(
              `⏳ Next trade allowed after: ${new Date(this.lastTradeExecutionTime + this.orderCooldownMs).toLocaleString()}\n`,
            );

            // LOCK ENGINE: We now have open positions
            this.hasActivePosition = true;

            // Update status
            opportunity.status = "executed";

            // Persist
            await mongoService.storeOpportunity(opportunity);

            // Start Phase 4 monitoring
            if (this.tradeMonitor && !this.paperTradingMode) {
              await this.registerTradeForMonitoring(
                opportunity,
                executionResult,
              );
            }
          } else {
            console.error(
              `\n❌ PHASE 3: Execution failed at ${executionResult.stage}`,
            );
            console.error(
              `   Reason: ${executionResult.reason || executionResult.error}`,
            );

            opportunity.status = "execution_failed";
            await mongoService.storeOpportunity(opportunity);
          }
        }
      } catch (error) {
        console.error(
          "❌ Critical error during trade execution:",
          error.message,
        );
        console.error(error.stack);
        opportunity.status = "execution_error";
      } finally {
        // Always release execution lock
        this.isExecuting = false;
        console.log("🔓 Execution lock released - ready for next opportunity");
      }
    }

    // Create final trade decision record
    const decision = {
      opportunityId,
      token: opportunity.token,
      decision:
        this.phase3Enabled && !this.paperTradingMode
          ? executionResult?.success
            ? "EXECUTED"
            : "EXECUTION_FAILED"
          : this.phase2Enabled && opportunity.phase2
            ? this.paperTradingMode
              ? "PAPER_TRADE_APPROVED"
              : "PROCEED_TO_PHASE_3"
            : "PROCEED_TO_PHASE_2",
      reason:
        this.phase3Enabled && !this.paperTradingMode
          ? executionResult?.success
            ? "Orders placed successfully on both exchanges"
            : executionResult?.reason || "Execution failed"
          : this.phase2Enabled && opportunity.phase2
            ? `Phase-2 ready: position size $${opportunity.phase2.positionSize.positionSizeUSD.toFixed(2)} with ${opportunity.phase2.positionSize.leverage}x leverage`
            : `Funding difference ${opportunity.fundingDiff.toFixed(4)}% exceeds ${opportunity.thresholdType} threshold ${opportunity.threshold}%`,
      timestamp: Date.now(),
      opportunity,
      paperTrading: this.paperTradingMode,
      executionResult,
    };

    this.lastDecision = decision;

    // Store decision
    await redisService.storeTradeDecision(decision);
    await mongoService.storeTradeDecision(decision);

    // Emit events
    this.emit("opportunity", opportunity);
    this.emit("decision", decision);

    console.log(`\n✅ Decision: ${decision.decision}`);
    console.log(`📝 Reason: ${decision.reason}`);

    if (this.paperTradingMode) {
      console.log(`⚠️  PAPER TRADING MODE - No real trades will be executed`);
    }

    console.log("");

    // Release execution lock if it wasn't released in Phase 3 finally block
    // (e.g., if phase3 was disabled or paper trading mode was active)
    if (this.isExecuting) {
      this.isExecuting = false;
      console.log("🔓 Execution lock released (end of handleOpportunity)");
    }
  }

  /**
   * Evaluate Phase 2: Position sizing, liquidity, and profitability
   * @param {Object} opportunity - Opportunity from Phase 1
   * @returns {Promise<Object>} - Phase 2 evaluation result
   */
  async evaluatePhase2(opportunity) {
    try {
      console.log("\n🔄 Starting Phase 2 Evaluation...");
      console.log("=".repeat(60));

      // Step 1: Calculate position size
      const positionSize =
        await positionSizer.calculatePositionSize(opportunity);

      if (!positionSize.canTrade) {
        return {
          canExecute: false,
          reason: positionSize.reason,
          positionSize,
        };
      }

      // Validate position
      if (!positionSizer.validatePosition(positionSize)) {
        return {
          canExecute: false,
          reason: "Position validation failed",
          positionSize,
        };
      }

      // Step 2: Analyze liquidity
      // const liquidityAnalysis = await liquidityAnalyzer.analyzeLiquidity(opportunity, positionSize);

      // if (!liquidityAnalysis.canExecute) {
      //   return {
      //     canExecute: false,
      //     reason: liquidityAnalysis.reason,
      //     positionSize,
      //     liquidityAnalysis
      //   };
      // }

      // Step 3: Calculate profit
      // const profitAnalysis = await profitCalculator.calculateProfit(
      //   opportunity,
      //   positionSize,
      //   liquidityAnalysis
      // );

      // if (!profitAnalysis.profitable) {
      //   return {
      //     canExecute: false,
      //     reason: `Net profit ${profitAnalysis.netProfitPct.toFixed(4)}% below minimum ${config.trading.minNetProfitPct}%`,
      //     positionSize,
      //     liquidityAnalysis,
      //     profitAnalysis
      //   };
      // }

      // Validate profit
      // if (!profitCalculator.validateProfit(profitAnalysis)) {
      //   return {
      //     canExecute: false,
      //     reason: 'Profit validation failed',
      //     positionSize,
      //     liquidityAnalysis,
      //     profitAnalysis
      //   };
      // }

      // All checks passed!
      console.log("\n" + "=".repeat(60));
      console.log("✅ PHASE 2: ALL CHECKS PASSED");
      console.log("=".repeat(60));
      // console.log(profitCalculator.generateSummary(profitAnalysis));
      console.log("=".repeat(60));

      return {
        canExecute: true,
        positionSize,
        // liquidityAnalysis,
        // profitAnalysis
      };
    } catch (error) {
      console.error("❌ Phase 2 evaluation error:", error);
      return {
        canExecute: false,
        reason: `Phase 2 error: ${error.message}`,
        error,
      };
    }
  }

  /**
   * Get current opportunities
   * @returns {Array<Object>}
   */
  getCurrentOpportunities() {
    return Array.from(this.opportunities.values());
  }

  /**
   * Get last trade decision
   * @returns {Object|null}
   */
  getLastDecision() {
    return this.lastDecision;
  }

  /**
   * Register trade for monitoring (Phase 4)
   */
  async registerTradeForMonitoring(opportunity, executionResult) {
    try {
      console.log("\n📊 PHASE 4: Registering trade for monitoring...");

      // Prepare trade data for monitoring
      const tradeData = {
        token: opportunity.token,
        deltaSymbol: opportunity.token,
        coindcxSymbol: opportunity.binanceSymbol,
        deltaSide: executionResult.deltaOrder.side,
        coindcxSide: executionResult.coindcxOrder.side,
        deltaOrderId: executionResult.deltaOrder.orderId,
        coindcxOrderId: executionResult.coindcxOrder.orderId,
        entryTime: Date.now(),
        fundingDiff: opportunity.fundingDiff,
        nextFundingTime: opportunity.FT_coindcx,
      };

      // Register with trade monitor
      this.tradeMonitor.registerTrade(tradeData);
      this.activeTrade = tradeData;

      console.log("✅ Trade monitoring activated");

      // CRITICAL FIX: Refresh positions via REST API to ensure monitors have latest data
      // WebSocket updates may be delayed after order execution
      console.log("\n🔄 Refreshing position data from both exchanges...");
      console.log(
        "   (Waiting 5 seconds for exchange APIs to process orders)\n",
      );

      await new Promise((resolve) => setTimeout(resolve, 5000)); // 5 second initial delay

      // Refresh positions on both monitors with retry logic (3 attempts, 3 seconds between attempts)
      if (
        this.tradeMonitor.deltaMonitor &&
        this.tradeMonitor.deltaMonitor.refreshPositions
      ) {
        await this.tradeMonitor.deltaMonitor.refreshPositions(
          executionResult.deltaOrder,
        );
      }

      if (
        this.tradeMonitor.coindcxMonitor &&
        this.tradeMonitor.coindcxMonitor.refreshPositions
      ) {
        await this.tradeMonitor.coindcxMonitor.refreshPositions();
      }

      console.log(
        "✅ Position refresh complete - monitors are now tracking active positions\n",
      );
    } catch (error) {
      console.error(
        "❌ Failed to register trade for monitoring:",
        error.message,
      );
    }
  }

  resetPositionLock() {
    this.hasActivePosition = false;
    this.activeTrade = null;
    if (this.tradeMonitor) {
      this.tradeMonitor.unregisterTrade();
    }
    console.log(
      "\nPOSITION FULLY CLOSED → Engine unlocked for new opportunities",
    );
  }

  /**
   * Handle emergency exit (Phase 5)
   */
  async handleEmergencyExit(exitData) {
    try {
      console.log("\n🚨 PHASE 5: EXECUTING EMERGENCY EXIT", exitData);
      console.log("=".repeat(60));

      // CHECK WHICH POSITIONS EXIST
      const hasDeltaPosition =
        exitData.details?.deltaPosition &&
        exitData.details.deltaPosition.size &&
        Math.abs(exitData.details.deltaPosition.size) > 0;

      // Properly extract CoinDCX size from any of the possible fields
      const coindcxSize = exitData.details?.coindcxPosition
        ? exitData.details.coindcxPosition.active_pos ||
          exitData.details.coindcxPosition.size ||
          exitData.details.coindcxPosition.positionAmount ||
          0
        : 0;

      const hasCoindcxPosition =
        exitData.details?.coindcxPosition && Math.abs(coindcxSize) > 0;

      console.log("\n📊 POSITION STATUS:");
      console.log(
        `   Delta: ${hasDeltaPosition ? "✅ Active" : "❌ Missing/Closed"}`,
      );
      console.log(
        `   CoinDCX: ${hasCoindcxPosition ? "✅ Active" : "❌ Missing/Closed"}`,
      );
      console.log("=".repeat(60));

      // HANDLE CASE WHERE BOTH ARE MISSING
      if (!hasDeltaPosition && !hasCoindcxPosition) {
        console.log("⚠️ Both positions are closed/missing. Nothing to exit.");
        this.tradeMonitor.unregisterTrade();
        this.activeTrade = null;
        return;
      }

      let deltaPosition = null;
      let coindcxPosition = null;

      // FETCH DELTA ORDERBOOK ONLY IF POSITION EXISTS
      if (hasDeltaPosition) {
        try {
          console.log(
            "\n---------------------------Trading Price Calculation (Delta)---------------------------",
          );
          const deltaOrderbookRaw = await deltaAPI.getOrderbook(
            exitData.details.deltaPosition.product_symbol,
            this.orderbookDepth,
          );

          const deltaOrderbook = positionSizer.normalizeOrderbook(
            deltaOrderbookRaw,
            "delta",
          );
          console.log(`   Delta Orderbook: ${JSON.stringify(deltaOrderbook)}`);

          const deltaSide =
            exitData.details.deltaPosition.side === "LONG" ? "sell" : "buy";
          console.log(`   Delta Side: ${deltaSide}`);
          console.log(
            `   Delta Quantity: ${exitData.details.deltaPosition.size * exitData.details.deltaPosition.product.contract_value}`,
          );

          const deltaTPResult =
            positionSizer.calculateTradingPriceFromOrderbook(
              deltaOrderbook,
              deltaSide,
              exitData.details.deltaPosition.size *
                exitData.details.deltaPosition.product.contract_value,
            );

          deltaPosition = deltaTPResult.tradingPrice;
          console.log(`   Delta Trading Price: ${deltaPosition}`);
          console.log(
            "-----------------------------------------------------------------------------------",
          );
        } catch (error) {
          console.error(
            `❌ Error calculating Delta exit price: ${error.message}`,
          );
          // Set to null, will try market order in exitManager
          deltaPosition = null;
        }
      } else {
        console.log("\n⏭️ Skipping Delta orderbook fetch (no position)");
      }

      // FETCH COINDCX ORDERBOOK ONLY IF POSITION EXISTS
      if (hasCoindcxPosition) {
        try {
          console.log(
            "\n---------------------------Trading Price Calculation (CoinDCX)---------------------------",
          );
          const coindcxOrderbookRaw = await coindcxAPI.getOrderbook(
            exitData.details.coindcxPosition.pair,
            this.orderbookDepth,
          );

          console.log("CoinDCX orderbook raw:", coindcxOrderbookRaw);
          const coindcxOrderbook = positionSizer.normalizeOrderbook(
            coindcxOrderbookRaw,
            "coindcx",
          );

          console.log("CoinDCX orderbook normalized:", coindcxOrderbook);
          const coindcxSide =
            exitData.details.coindcxPosition.positionType === "SHORT"
              ? "buy"
              : "sell";

          const coindcxTPResult =
            positionSizer.calculateTradingPriceFromOrderbook(
              coindcxOrderbook,
              coindcxSide,
              exitData.details.coindcxPosition.size,
            );

          coindcxPosition = coindcxTPResult.tradingPrice;
          console.log(`   CoinDCX Trading Price: ${coindcxPosition}`);
          console.log(
            "-----------------------------------------------------------------------------------",
          );
        } catch (error) {
          console.error(
            `❌ Error calculating CoinDCX exit price: ${error.message}`,
          );
          // Set to null, will try market order in exitManager
          coindcxPosition = null;
        }
      } else {
        console.log("\n⏭️ Skipping CoinDCX orderbook fetch (no position)");
      }

      // SUMMARY
      console.log(
        "\n=========================== EXIT SUMMARY ===========================",
      );
      console.log(
        `   Delta Position: ${hasDeltaPosition ? (deltaPosition ? `✅ Exit Price: $${deltaPosition}` : "⚠️ Will use market order") : "⏭️ No position"}`,
      );
      console.log(
        `   CoinDCX Position: ${hasCoindcxPosition ? (coindcxPosition ? `✅ Exit Price: $${coindcxPosition}` : "⚠️ Will use market order") : "⏭️ No position"}`,
      );
      console.log(
        "====================================================================",
      );

      // ============================================================
      // 🎯 REVALIDATE SPREAD WITH ACTUAL TRADING PRICES
      // ============================================================
      if (deltaPosition && coindcxPosition) {
        console.log("\n🔍 REVALIDATING SPREAD WITH ACTUAL TRADING PRICES");
        console.log("━".repeat(60));

        // Determine which is SHORT and which is LONG based on original trade direction
        const deltaSide = exitData.details.deltaPosition.side; // 'LONG' or 'SHORT'
        const coindcxPositionType =
          exitData.details.coindcxPosition.positionType; // 'LONG' or 'SHORT'

        // When exiting:
        // - If original Delta position was LONG → we SELL at deltaPosition (bid price)
        // - If original Delta position was SHORT → we BUY at deltaPosition (ask price)
        // Same logic for CoinDCX
        const deltaExitPrice = deltaPosition;
        const coindcxExitPrice = coindcxPosition;

        console.log(`   Original Positions:`);
        console.log(
          `     Delta: ${deltaSide} → Exiting with ${deltaSide === "LONG" ? "SELL" : "BUY"}`,
        );
        console.log(
          `     CoinDCX: ${coindcxPositionType} → Exiting with ${coindcxPositionType === "LONG" ? "SELL" : "BUY"}`,
        );
        console.log(`   Exit Prices:`);
        console.log(`     Delta Exit Price: $${deltaExitPrice.toFixed(8)}`);
        console.log(`     CoinDCX Exit Price: $${coindcxExitPrice.toFixed(8)}`);

        // Calculate actual executable spread
        // The spread is the price difference between the two exchanges
        const actualSpread =
          Math.abs((coindcxExitPrice - deltaExitPrice) / deltaExitPrice) * 100;

        console.log(`   Actual Executable Spread: ${actualSpread.toFixed(4)}%`);

        const EXIT_SPREAD_TARGET = 0.05; // 0.05%

        // Only validate spread if this exit was triggered by spread convergence
        if (exitData.reason && exitData.reason.includes("SPREAD_CONVERGENCE")) {
          console.log(
            `   Exit Trigger: SPREAD_CONVERGENCE → Validating spread...`,
          );

          if (actualSpread > EXIT_SPREAD_TARGET) {
            console.log(`\n⚠️ SPREAD REVALIDATION FAILED!`);
            console.log(`   Expected: ≤ ${EXIT_SPREAD_TARGET}%`);
            console.log(`   Actual: ${actualSpread.toFixed(4)}%`);
            console.log(
              `   Price Difference: $${Math.abs(coindcxExitPrice - deltaExitPrice).toFixed(8)}`,
            );
            console.log(
              `   → Spread widened since mark price detection. ABORTING EXIT.`,
            );
            console.log("━".repeat(60));

            // Don't exit - spread is not favorable anymore
            console.log("🚫 Exit aborted - spread no longer meets target");
            console.log(
              "   Trade will continue monitoring for better exit opportunity",
            );
            return;
          }

          console.log(
            `✅ SPREAD REVALIDATION PASSED: ${actualSpread.toFixed(4)}% ≤ ${EXIT_SPREAD_TARGET}%`,
          );
          console.log(`   → Safe to proceed with exit`);
          console.log(`   → Profit capture confirmed at orderbook level`);
        } else {
          console.log(
            `ℹ️ Spread check skipped (exit reason: ${exitData.reason})`,
          );
          console.log(`   Current actual spread: ${actualSpread.toFixed(4)}%`);
          console.log(
            `   → Proceeding with emergency exit regardless of spread`,
          );
        }

        console.log("━".repeat(60));
      } else {
        console.log("\n⚠️ Cannot revalidate spread - missing trading prices");
        console.log(`   Delta TP: ${deltaPosition ? "Available" : "Missing"}`);
        console.log(
          `   CoinDCX TP: ${coindcxPosition ? "Available" : "Missing"}`,
        );
        console.log("   → Proceeding with market orders\n");
      }
      // ============================================================

      // Set exit data
      exitData.deltaPosition = deltaPosition;
      exitData.coindcxPosition = coindcxPosition;

      // Execute emergency exit using Exit Manager
      const exitResult = await exitManager.executeEmergencyExit(
        exitData,
        deltaPosition,
        coindcxPosition,
        {
          reason: exitData.reason,
          details: exitData.details,
        },
      );

      // Log results
      if (exitResult.success) {
        this.resetPositionLock();
        console.log("\n✅ EMERGENCY EXIT COMPLETED SUCCESSFULLY");
        if (hasDeltaPosition && exitResult.deltaExit?.orderId) {
          console.log(`   Delta Order ID: ${exitResult.deltaExit.orderId}`);
        }
        if (hasCoindcxPosition && exitResult.coindcxExit?.orderId) {
          console.log(`   CoinDCX Order ID: ${exitResult.coindcxExit.orderId}`);
        }

        // Confirm exit to trade monitor to clean up state
        console.log("\n📝 Confirming exit completion to trade monitor...");

        // Pass which exchanges successfully exited
        const deltaExited = hasDeltaPosition && exitResult.deltaExit?.success;
        const coindcxExited =
          hasCoindcxPosition && exitResult.coindcxExit?.success;

        console.log(`   Delta exited: ${deltaExited ? "✅ Yes" : "❌ No"}`);
        console.log(`   CoinDCX exited: ${coindcxExited ? "✅ Yes" : "❌ No"}`);

        this.tradeMonitor.confirmExitComplete(deltaExited, coindcxExited);
      } else {
        console.error("\n❌ EMERGENCY EXIT FAILED");
        console.error(`   Stage: ${exitResult.stage}`);
        console.error(`   Reason: ${exitResult.reason || "Unknown"}`);

        // Check which exchanges actually succeeded despite overall failure
        const deltaExited = hasDeltaPosition && exitResult.deltaExit?.success;
        const coindcxExited =
          hasCoindcxPosition && exitResult.coindcxExit?.success;

        // Still confirm to clean up monitor, but log that exit failed
        console.log("\n⚠️ Exit partially failed, cleaning up monitor state...");
        console.log(`   Delta exited: ${deltaExited ? "✅ Yes" : "❌ No"}`);
        console.log(`   CoinDCX exited: ${coindcxExited ? "✅ Yes" : "❌ No"}`);

        this.tradeMonitor.confirmExitComplete(deltaExited, coindcxExited);
      }

      // Clear active trade
      this.activeTrade = null;

      console.log("=".repeat(60));
    } catch (error) {
      console.error("❌ Critical error during emergency exit:", error.message);
      console.error(error.stack);
    }
  }

  /**
   * Handle normal exit after funding (Phase 5)
   * This would typically be triggered by a timer or funding event detection
   */
  async handleNormalExit(exitData) {
    try {
      console.log("\n📊 PHASE 5: EXECUTING NORMAL EXIT (POST-FUNDING)");
      console.log("=".repeat(60));

      // if (!this.activeTrade) {
      //   console.error('❌ No active trade to exit');
      //   return;
      // }

      console.log(
        "---------------------------Trading Price Calculation Start---------------------------",
        exitData,
      );
      const deltaOrderbookRaw = await deltaAPI.getOrderbook(
        exitData.details.deltaPosition.product_symbol,
        this.orderbookDepth,
      );

      const deltaOrderbook = positionSizer.normalizeOrderbook(
        deltaOrderbookRaw,
        "delta",
      );
      console.log(`   Delta Orderbook: ${JSON.stringify(deltaOrderbook)}`);
      const deltaSide =
        exitData.details.deltaPosition.side === "LONG" ? "sell" : "buy";

      console.log(`   Delta Side: ${deltaSide}`);
      console.log(
        `   Delta Quantity: ${exitData.details.deltaPosition.size * exitData.details.deltaPosition.product.contract_value}`,
      );
      const deltaTPResult = positionSizer.calculateTradingPriceFromOrderbook(
        deltaOrderbook,
        deltaSide,
        exitData.details.deltaPosition.size *
          exitData.details.deltaPosition.product.contract_value,
      );
      console.log(
        "---------------------------Trading Price Calculation Start---------------------------",
      );

      console.log(`\nStep 4: Fetching Coindcx orderbook...`);
      // const convertedSymbol = `B-${opportunity.binanceSymbol.replace(/(USDT)$/, "_$1")}`;
      // console.log("converted symbol", convertedSymbol)
      const coindcxOrderbookRaw = await coindcxAPI.getOrderbook(
        exitData.details.coindcxPosition.pair,
        this.orderbookDepth,
      );

      console.log("refwewefwef", coindcxOrderbookRaw);
      const coindcxOrderbook = positionSizer.normalizeOrderbook(
        coindcxOrderbookRaw,
        "coindcx",
      );

      console.log("erfewrwefwe", coindcxOrderbook);
      const coindcxSide =
        exitData.details.coindcxPosition.positionType === "SHORT"
          ? "buy"
          : "sell";
      const coindcxTPResult = positionSizer.calculateTradingPriceFromOrderbook(
        coindcxOrderbook,
        coindcxSide,
        exitData.details.coindcxPosition.size,
      );
      console.log("coinDedrfwae", coindcxTPResult);

      const deltaPosition = deltaTPResult.tradingPrice;
      const coindcxPosition = coindcxTPResult.tradingPrice;

      console.log(
        "---------------------------Trading Price Calculation End---------------------------",
      );
      console.log(`   Delta Trading Price: ${deltaPosition}`);
      console.log(`   Coindcx Trading Price: ${coindcxPosition}`);
      console.log(
        "-----------------------------------------------------------------------------------",
      );

      exitData.deltaPosition = deltaPosition;
      exitData.coindcxPosition = coindcxPosition;

      //---------------------------Trading Price Calculation End---------------------------//

      if (!deltaPosition || !coindcxPosition) {
        console.error("❌ Could not retrieve positions for exit");
        console.error(
          `   Delta Position: ${deltaPosition ? "Found" : "NOT FOUND"}`,
        );
        console.error(
          `   COindcx Position: ${coindcxPosition ? "Found" : "NOT FOUND"}`,
        );
        return;
      }

      const exitResult = await exitManager.executeNormalExit(
        exitData,
        deltaPosition,
        coindcxPosition,
      );

      const deltaExited = !!exitResult?.deltaExit?.success;
      const coindcxExited = !!exitResult?.coindcxExit?.success;

      // Log results
      if (exitResult.success) {
        this.resetPositionLock();
        console.log("\n✅ NORMAL EXIT COMPLETED SUCCESSFULLY");
        console.log(`   Exit Type: ${exitResult.type}`);
        console.log(`   Delta Order ID: ${exitResult.deltaExit.orderId}`);
        console.log(`   COindcx Order ID: ${exitResult.coindcxExit.orderId}`);

        // Confirm full exit to monitor
        this.tradeMonitor.confirmExitComplete(true, true);
        this.activeTrade = null;
      } else {
        console.error("\n❌ NORMAL EXIT FAILED");
        console.error(`   Stage: ${exitResult.stage}`);
        console.error(`   Reason: ${exitResult.reason || "Unknown"}`);

        console.log(
          "\n⚠️ Normal exit partially/fully failed, keeping monitor active...",
        );
        console.log(`   Delta exited: ${deltaExited ? "✅ Yes" : "❌ No"}`);
        console.log(`   CoinDCX exited: ${coindcxExited ? "✅ Yes" : "❌ No"}`);

        // Confirm partial exits only; monitor stays active for remaining side
        this.tradeMonitor.confirmExitComplete(deltaExited, coindcxExited);

        if (deltaExited && coindcxExited) {
          this.activeTrade = null;
        }
      }

      console.log("=".repeat(60));
    } catch (error) {
      console.error("❌ Critical error during normal exit:", error.message);
      console.error(error.stack);
    }
  }

  /**
   * Stop the arbitrage engine
   */
  async stop() {
    console.log("\n🛑 Stopping Arbitrage Engine...");

    this.isRunning = false;

    // Stop trade monitor if running
    if (this.tradeMonitor) {
      this.tradeMonitor.stop();
    }

    // Disconnect exchanges
    this.deltaExchange.disconnect();
    this.coindcxExchange.disconnect();

    // Disconnect services
    await redisService.disconnect();
    await mongoService.disconnect();

    console.log("✅ Arbitrage Engine stopped");
    this.emit("stopped");
  }
}

export default ArbitrageEngine;
