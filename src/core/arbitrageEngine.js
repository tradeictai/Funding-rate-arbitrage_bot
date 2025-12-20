import EventEmitter from 'events';
import DeltaExchange from '../exchanges/deltaExchange.js';
import BinanceExchange from '../exchanges/BinanceExchange.js';
import symbolMapper from '../utils/symbolMapper.js';
import redisService from '../services/redisService.js';
import mongoService from '../services/mongoService.js';
import config from '../config/config.js';

// Phase 2 imports
import positionSizer from './positionSizer.js';
import liquidityAnalyzer from './liquidityAnalyzer.js';
import profitCalculator from './profitCalculator.js';

// Phase 3 imports
import orderExecutor from './orderExecutor.js';

// Phase 4 & 5 imports
import TradeMonitor from '../monitors/tradeMonitor.js';
import exitManager from './exitManager.js';
import deltaAPI from '../services/deltaAPI.js';
import pi42API from '../services/pi42API.js';

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
    this.pi42Exchange = new BinanceExchange();

    // State
    this.isRunning = false;
    this.opportunities = new Map();
    this.lastDecision = null;

    // Thresholds
    this.TH1 = config.trading.primaryThreshold;      // 0.1%
    this.TH2 = config.trading.secondaryThreshold;    // 0.1%
    this.fundingTimeWindow = config.trading.fundingTimeWindowSeconds; // 60 seconds
    this.orderbookDepth = config.trading.orderbookDepth;
    // Phase 2 configuration
    this.paperTradingMode = config.trading.paperTradingMode;
    this.phase2Enabled = true; // Enable Phase 2 evaluation

    // Phase 3 configuration
    this.phase3Enabled = true; // Enable Phase 3 order execution

    // Phase 4 & 5: Trade Monitor and Exit Manager
    this.tradeMonitor = null; // Initialized after exchanges connect
    this.activeTrade = null; // Current active trade being monitored

    // Bind event handlers
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for exchange updates
   */
  setupEventHandlers() {
    // Delta updates
    this.deltaExchange.on('update', async (data) => {
      await this.handleDeltaUpdate(data);
    });

    this.deltaExchange.on('connected', () => {
      console.log('📊 Delta Exchange connected and streaming data');
    });

    // Pi42 updates
    this.pi42Exchange.on('batchUpdate', async () => {
      await this.processPotentialOpportunities();
    });

    this.pi42Exchange.on('connected', () => {
      console.log('📊 Pi42 Exchange connected and streaming data');
    });
  }

  /**
   * Setup Trade Monitor event handlers (Phase 4 & 5)
   */
  setupTradeMonitorHandlers() {
    if (!this.tradeMonitor) return;

    // Quantity mismatch event
    this.tradeMonitor.on('quantityMismatch', async (data) => {
      console.error('\n❌ QUANTITY MISMATCH DETECTED');
      console.error(`   Delta Quantity: ${data.deltaQty}`);
      console.error(`   Pi42 Quantity: ${data.pi42Qty}`);
      console.error(`   Difference: ${data.differencePct.toFixed(2)}%`);
    });

    // Flip detection event
    this.tradeMonitor.on('flip', async (data) => {
      console.error('\n❌ FUNDING RATE FLIP DETECTED');
      console.error(`   Current Funding Diff: ${data.fundingDiff}%`);
      console.error(`   Threshold: ${data.threshold}%`);
    });

    // Emergency exit event (from either quantity mismatch or flip)
    this.tradeMonitor.on('emergencyExit', async (exitData) => {
      console.log('\n🚨 EMERGENCY EXIT EVENT RECEIVED');
      console.log(`   Reason: ${exitData.reason}`);

      await this.handleEmergencyExit(exitData);
    });

    this.tradeMonitor.on('normalExit', async (exitData) => {
      console.log('\n⏰ NORMAL EXIT EVENT RECEIVED');
      console.log(`   Reason: ${exitData.reason}`);

      await this.handleEmergencyExit(exitData);
    });
    // Trade registered event
    this.tradeMonitor.on('tradeRegistered', (trade) => {
      console.log('✅ Trade registered for monitoring');
    });
  }

  /**
   * Start the arbitrage engine
   */
  async start() {
    console.log('🚀 Starting Funding Rate Arbitrage Engine - Phase 1, 2, 3, 4 & 5');
    console.log('━'.repeat(50));

    try {
      // Connect to Redis
      await redisService.connect();

      // Connect to MongoDB
      await mongoService.connect();

      // Connect to exchanges
      this.deltaExchange.connect();
      this.pi42Exchange.connect();

      // Initialize and start Trade Monitor (Phase 4)
      if (!this.paperTradingMode) {
        console.log('\n🔄 Initializing Trade Monitor (Phase 4)...');
        this.tradeMonitor = new TradeMonitor(this.deltaExchange, this.pi42Exchange);
        this.setupTradeMonitorHandlers();
        await this.tradeMonitor.start();
      }

      this.isRunning = true;

      console.log('━'.repeat(50));
      console.log('✅ Arbitrage Engine started successfully');
      console.log(`📈 Primary Threshold (TH1): ${this.TH1}%`);
      console.log(`📊 Secondary Threshold (TH2): ${this.TH2}%`);
      console.log(`⏱️  Funding Time Window: ${this.fundingTimeWindow}s`);
      console.log(`🔧 Phase 2 Enabled: ${this.phase2Enabled}`);
      console.log(`⚡ Phase 3 Enabled: ${this.phase3Enabled}`);
      console.log(`📝 Paper Trading Mode: ${this.paperTradingMode}`);
      console.log(`🔍 Trade Monitoring: ${!this.paperTradingMode ? 'ENABLED' : 'DISABLED (Paper Trading)'}`);
      console.log('━'.repeat(50));

      this.emit('started');
    } catch (error) {
      console.error('❌ Failed to start arbitrage engine:', error);
      throw error;
    }
  }

  /**
   * Handle Delta exchange updates
   */
  async handleDeltaUpdate(data) {
    // Cache in Redis
    await redisService.storeFundingData('delta', data.symbol, data);

    // Periodically persist to MongoDB (every 10th update to reduce load)
    if (Math.random() < 0.1) {
      await mongoService.storeFundingRate('delta', data.symbol, data);
    }
  }

  /**
   * Process potential arbitrage opportunities
   * This is the main Phase 1 logic - BIDIRECTIONAL SEARCH
   */
  async processPotentialOpportunities() {
    if (!this.isRunning) return;

    try {
      // Step 1: Get top candidates from BOTH exchanges
      const deltaSymbols = this.deltaExchange.getSymbolsSortedByFundingRate();
      const BinanceSymbols = this.pi42Exchange.getSymbolsSortedByFundingRate();

      if (deltaSymbols.length === 0) {
        console.log('⏳ Waiting for Delta funding rate data...');
        return;
      }

      if (BinanceSymbols.length === 0) {
        console.log('⏳ Waiting for Binance funding rate data...');
        return;
      }

      const topN = 15; // Check top 15 from each exchange
      const deltaTop = deltaSymbols.slice(0, topN);
      const BinanceTop = BinanceSymbols.slice(0, topN);

      console.log(`\n🔍 Scanning: Top ${deltaTop.length} Delta tokens vs Top ${BinanceTop.length} Binance tokens`);

      // Step 2: Collect all valid opportunities
      const allOpportunities = [];
      const checkedPairs = new Set(); // Track which pairs we've already evaluated

      // 2a. Check Delta top tokens against Pi42
      for (const deltaData of deltaTop) {
        const deltaSymbol = deltaData.symbol;
        const BinanceSymbol = symbolMapper.deltaToPi42(deltaSymbol);

        if (!BinanceSymbol) continue;

        const pairKey = `${deltaSymbol}-${BinanceSymbol}`;
        checkedPairs.add(pairKey);

        const opportunity = await this.evaluateOpportunityFromDelta(deltaData);
        if (opportunity) {
          allOpportunities.push(opportunity);
        }
      }

      // 2b. Check Pi42 top tokens against Delta (avoid duplicates)
      for (const binanceData of BinanceTop) {
        const binanceSymbol = binanceData.symbol;
        const deltaSymbol = symbolMapper.pi42ToDelta(binanceSymbol);

        if (!deltaSymbol) continue;

        const pairKey = `${deltaSymbol}-${binanceSymbol}`;
        // Skip if we already checked this pair
        if (checkedPairs.has(pairKey)) continue;

        checkedPairs.add(pairKey);

        const opportunity = await this.evaluateOpportunityFromPi42(binanceData);
        if (opportunity) {
          allOpportunities.push(opportunity);
        }
      }

      // Step 3: Rank opportunities by funding differential (highest first)
      if (allOpportunities.length > 0) {
        allOpportunities.sort((a, b) => b.fundingDiff - a.fundingDiff);

        console.log(`✅ Found ${allOpportunities.length} valid opportunity(ies)`);
        console.log(`🎯 Best opportunity: ${allOpportunities[0].token} with ${allOpportunities[0].fundingDiff.toFixed(4)}% differential\n`);

        // Handle the best opportunity
        await this.handleOpportunity(allOpportunities[0]);
      } else {
        console.log(`❌ No opportunities found (checked ${checkedPairs.size} unique pairs)`);
      }

    } catch (error) {
      console.error('Error processing opportunities:', error);
    }
  }

  /**
   * Evaluate opportunity starting from Delta data
   * @param {Object} deltaData - Delta exchange funding data
   * @returns {Object|null} - Opportunity object or null
   */
  async evaluateOpportunityFromDelta(deltaData) {
    const deltaSymbol = deltaData.symbol;
    const pi42Symbol = symbolMapper.deltaToPi42(deltaSymbol);

    if (!pi42Symbol) return null;

    const pi42Data = this.pi42Exchange.getFundingData(pi42Symbol);
    if (!pi42Data) return null;

    return this.evaluateOpportunity(deltaData, pi42Data);
  }

  /**
   * Evaluate opportunity starting from Pi42 data
   * @param {Object} pi42Data - Pi42 exchange funding data
   * @returns {Object|null} - Opportunity object or null
   */
  async evaluateOpportunityFromPi42(pi42Data) {
    const pi42Symbol = pi42Data.symbol;
    const deltaSymbol = symbolMapper.pi42ToDelta(pi42Symbol);

    if (!deltaSymbol) return null;

    const deltaData = this.deltaExchange.getFundingData(deltaSymbol);
    if (!deltaData) return null;

    return this.evaluateOpportunity(deltaData, pi42Data);
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
    const deltaSymbol = deltaData.symbol;
    const binanceSymbol = binanceData.symbol;


    console.log(`🔎 Evaluating pair: Delta ${deltaSymbol} & Binance ${binanceSymbol}`);

    const FR_EX1 = deltaData.fundingRate;
    const FT_EX1_ts = deltaData.nextFundingTime;
    const FR_EX2 = binanceData.fundingRate;
    const FT_EX2_ts = binanceData.nextFundingTime;


    console.log(`   Delta FR: ${FR_EX1}%, Next FT: ${FT_EX1_ts ? new Date(FT_EX1_ts).toLocaleString() : 'N/A'}`);
    console.log(`   Binance  FR: ${FR_EX2}%, Next FT: ${FT_EX2_ts ? new Date(FT_EX2_ts).toLocaleString() : 'N/A'}`);
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
      exchange_first = 'delta';
      exchange_second = 'binance';
    } else {
      FR_first = FR_EX2;
      FR_second = FR_EX1;
      exchange_first = 'binance';
      exchange_second = 'delta';
    }

    // Step 7: Calculate funding rate difference
    const diff = this.calculateFundingDifference(FR_first, FR_second);

    console.log(`   Funding Rate Diff: ${diff}%`);

    // Step 8: Check thresholds
    const thresholdResult = this.checkThresholds(diff);

    console.log(`   Threshold Check: ${thresholdResult.passed ? 'PASSED' : 'NOT PASSED'}`);

    if (!thresholdResult.passed) {
      // Threshold not met
      return null;
    }

    // Create opportunity object
    const opportunity = {
      token: deltaSymbol,
      binanceSymbol: binanceSymbol,
      timestamp: Date.now(),

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
      status: 'identified'
    };
    // console.log('   Opportunity identified:879999999999999999999999999999999999', opportunity);
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
        type: 'primary'
      };
    } else if (diff >= this.TH2) {

      console.log(`   Threshold Check: PASSED (Secondary TH2: ${this.TH2}%)`);
      return {
        passed: true,
        threshold: this.TH2,
        type: 'secondary'
      };
    } else {

      console.log(`   Threshold Check: NOT PASSED (Diff: ${diff}%)`);
      return {
        passed: false,
        threshold: null,
        type: null
      };
    }
  }

  /**
   * Handle a valid arbitrage opportunity
   *
   * @param {Object} opportunity - Opportunity object
   */
  async handleOpportunity(opportunity) {
    const opportunityId = `${opportunity.token}_${opportunity.timestamp}`;

    console.log('\n' + '='.repeat(60));
    console.log('🎯 PHASE 1: ARBITRAGE OPPORTUNITY DETECTED');
    console.log('='.repeat(60));
    console.log(`Token:           ${opportunity.token} / ${opportunity.pi42Symbol}`);
    console.log(`Funding Diff:    ${opportunity.fundingDiff.toFixed(4)}%`);
    console.log(`Threshold:       ${opportunity.threshold}% (${opportunity.thresholdType})`);
    console.log(`Delta FR:        ${opportunity.FR_delta.toFixed(4)}%`);
    console.log(`Binance FR:         ${opportunity.FR_binance.toFixed(4)}%`);
    console.log(`Time Diff:       ${opportunity.timeDiff.toFixed(2)}s`);
    console.log(`Next Funding:    ${new Date(opportunity.FT_binance).toLocaleString()}`);
    console.log(`Delta Funding:   ${opportunity.FT_delta ? new Date(opportunity.FT_delta).toLocaleString() : 'N/A'}`);
    console.log(`Binance Funding:    ${opportunity.FT_binance ? new Date(opportunity.FT_binance).toLocaleString() : 'N/A'}`);
    console.log('='.repeat(60));

    // Phase 2: Evaluate profitability
    if (this.phase2Enabled) {
      const phase2Result = await this.evaluatePhase2(opportunity);

      if (!phase2Result.canExecute) {
        console.log(`\n❌ PHASE 2: Opportunity rejected - ${phase2Result.reason}\n`);

        // Store rejected opportunity
        await mongoService.storeOpportunity({
          ...opportunity,
          phase2Result,
          status: 'rejected_phase2'
        });

        return;
      }

      // Add Phase 2 data to opportunity
      opportunity.phase2 = phase2Result;
    }

    // Store in memory
    this.opportunities.set(opportunityId, opportunity);

    // Cache in Redis
    await redisService.storeOpportunity(opportunityId, opportunity);

    // Persist to MongoDB
    // await mongoService.storeOpportunity(opportunity);

    // Phase 3: Execute trades if enabled and not in paper trading mode
    let executionResult = null;

    if (this.phase3Enabled && !this.paperTradingMode) {
      console.log('\n🚀 Proceeding to Phase 3: Order Execution...', opportunity);

      // Get fresh funding data before execution
      const deltaFundingData = this.deltaExchange.getFundingData(opportunity.token);
      const coindcxFundingData = this.pi42Exchange.getFundingData(opportunity.binanceSymbol);
      
      // console.log("dfhaskdfas", deltaFundingData,coindcxFundingData )
      if (!deltaFundingData || !coindcxFundingData) {
        console.error('❌ Cannot execute: Fresh funding data not available');
      } else {
        // Execute the arbitrage trade
        executionResult = await orderExecutor.executeArbitrageTrade(
          opportunity,
          deltaFundingData,
          coindcxFundingData
        );

        // Store execution result
        opportunity.phase3 = executionResult;

        if (executionResult.success) {
          console.log('\n✅ PHASE 3: Orders executed successfully on both exchanges!');

          // Update opportunity status
          opportunity.status = 'executed';

          // Persist execution result
          await mongoService.storeOpportunity(opportunity);

          // Phase 4: Register trade for monitoring
          if (this.tradeMonitor && !this.paperTradingMode) {
            await this.registerTradeForMonitoring(opportunity, executionResult);
          }
        } else {
          console.error(`\n❌ PHASE 3: Execution failed at ${executionResult.stage}`);
          console.error(`   Reason: ${executionResult.reason || executionResult.error}`);

          // Update opportunity status
          opportunity.status = 'execution_failed';

          // Persist failed execution
          await mongoService.storeOpportunity(opportunity);
        }
      }
    }

    // console.log("opportunity phase 2", opportunity.phase2)

    // Create trade decision
    const decision = {
      opportunityId,
      token: opportunity.token,
      decision: this.phase3Enabled && !this.paperTradingMode ?
        (executionResult?.success ? 'EXECUTED' : 'EXECUTION_FAILED') :
        (this.phase2Enabled && opportunity.phase2 ?
          (this.paperTradingMode ? 'PAPER_TRADE_APPROVED' : 'PROCEED_TO_PHASE_3') :
          'PROCEED_TO_PHASE_2'),
      reason: this.phase3Enabled && !this.paperTradingMode ?
        (executionResult?.success ? 'Orders placed successfully on both exchanges' : executionResult?.reason || 'Execution failed') :
        (
      this.phase2Enabled && opportunity.phase2
        ? `Phase-2 ready: position size $${opportunity.phase2.positionSize.positionSizeUSD.toFixed(2)} with ${opportunity.phase2.positionSize.leverage}x leverage`
        : `Funding difference ${opportunity.fundingDiff.toFixed(4)}% exceeds ${opportunity.thresholdType} threshold ${opportunity.threshold}%`
    ),
      timestamp: Date.now(),
      opportunity,
      paperTrading: this.paperTradingMode,
      executionResult
    };

    this.lastDecision = decision;

    // Store decision
    await redisService.storeTradeDecision(decision);
    await mongoService.storeTradeDecision(decision);

    // Emit opportunity event
    this.emit('opportunity', opportunity);
    this.emit('decision', decision);

    console.log(`\n✅ Decision: ${decision.decision}`);
    console.log(`📝 Reason: ${decision.reason}`);

    if (this.paperTradingMode) {
      console.log(`⚠️  PAPER TRADING MODE - No real trades will be executed`);
    }

    console.log('');
  }

  /**
   * Evaluate Phase 2: Position sizing, liquidity, and profitability
   * @param {Object} opportunity - Opportunity from Phase 1
   * @returns {Promise<Object>} - Phase 2 evaluation result
   */
  async evaluatePhase2(opportunity) {
    try {
      console.log('\n🔄 Starting Phase 2 Evaluation...');
      console.log('='.repeat(60));

      // Step 1: Calculate position size
      const positionSize = await positionSizer.calculatePositionSize(opportunity);

      if (!positionSize.canTrade) {
        return {
          canExecute: false,
          reason: positionSize.reason,
          positionSize
        };
      }

      // Validate position
      if (!positionSizer.validatePosition(positionSize)) {
        return {
          canExecute: false,
          reason: 'Position validation failed',
          positionSize
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
      console.log('\n' + '='.repeat(60));
      console.log('✅ PHASE 2: ALL CHECKS PASSED');
      console.log('='.repeat(60));
      // console.log(profitCalculator.generateSummary(profitAnalysis));
      console.log('='.repeat(60));

      return {
        canExecute: true,
        positionSize,
        // liquidityAnalysis,
        // profitAnalysis
      };

    } catch (error) {
      console.error('❌ Phase 2 evaluation error:', error);
      return {
        canExecute: false,
        reason: `Phase 2 error: ${error.message}`,
        error
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
      console.log('\n📊 PHASE 4: Registering trade for monitoring...');

      // Prepare trade data for monitoring
      const tradeData = {
        token: opportunity.token,
        deltaSymbol: opportunity.token,
        pi42Symbol: opportunity.pi42Symbol,
        deltaSide: executionResult.deltaOrder.side,
        pi42Side: executionResult.pi42Order.side,
        deltaOrderId: executionResult.deltaOrder.orderId,
        pi42OrderId: executionResult.pi42Order.orderId,
        entryTime: Date.now(),
        fundingDiff: opportunity.fundingDiff,
        nextFundingTime: opportunity.FT_pi42
      };

      // Register with trade monitor
      this.tradeMonitor.registerTrade(tradeData);
      this.activeTrade = tradeData;

      console.log('✅ Trade monitoring activated');

    } catch (error) {
      console.error('❌ Failed to register trade for monitoring:', error.message);
    }
  }

  /**
   * Handle emergency exit (Phase 5)
   */
  async handleEmergencyExit(exitData) {
    try {
      console.log('\n🚨 PHASE 5: EXECUTING EMERGENCY EXIT');
      console.log('='.repeat(60));

      // if (!this.activeTrade) {
      //   console.error('❌ No active trade to exit');
      //   return;
      // }

      // Get current positions from both exchanges

      console.log("---------------------------Trading Price Calculation Start---------------------------", exitData
      );
      const deltaOrderbookRaw = await deltaAPI.getOrderbook(exitData.details.deltaPosition.product_symbol, this.orderbookDepth);

      const deltaOrderbook = positionSizer.normalizeOrderbook(deltaOrderbookRaw, 'delta');
      console.log(`   Delta Orderbook: ${JSON.stringify(deltaOrderbook)}`);
      const deltaSide = exitData.details.deltaPosition.side === 'LONG' ? 'sell' : 'buy';

      console.log(`   Delta Side: ${deltaSide}`);
      console.log(`   Delta Quantity: ${exitData.details.deltaPosition.size * exitData.details.deltaPosition.product.contract_value}`);
      const deltaTPResult = positionSizer.calculateTradingPriceFromOrderbook(deltaOrderbook, deltaSide, exitData.details.deltaPosition.size * exitData.details.deltaPosition.product.contract_value);
      console.log('---------------------------Trading Price Calculation Start---------------------------');



      // console.log(`   Delta Trading Price Result: ${JSON.stringify(deltaTPResult)}`);
      const pi42OrderbookRaw = await pi42API.getOrderbook(exitData.details.pi42Position.contractPair, this.orderbookDepth);
      const pi42Orderbook = positionSizer.normalizeOrderbook(pi42OrderbookRaw, 'pi42');
      // console.log(`   Pi42 Orderbook: ${JSON.stringify(pi42Orderbook)}`);
      const pi42Side = exitData.details.pi42Position.positionType === 'SHORT' ? 'buy' : 'sell';
      const pi42TPResult = positionSizer.calculateTradingPriceFromOrderbook(pi42Orderbook, pi42Side, exitData.details.pi42Position.quantity);


      const deltaPosition = deltaTPResult.tradingPrice
      const pi42Position = pi42TPResult.tradingPrice


      console.log('---------------------------Trading Price Calculation End---------------------------');
      console.log(`   Delta Trading Price: ${deltaPosition}`);
      console.log(`   Pi42 Trading Price: ${pi42Position}`);
      console.log('-----------------------------------------------------------------------------------');

      exitData.deltaPosition = deltaPosition;
      exitData.pi42Position = pi42Position;

      //---------------------------Trading Price Calculation End---------------------------//

      if (!deltaPosition || !pi42Position) {
        console.error('❌ Could not retrieve positions for exit');
        console.error(`   Delta Position: ${deltaPosition ? 'Found' : 'NOT FOUND'}`);
        console.error(`   Pi42 Position: ${pi42Position ? 'Found' : 'NOT FOUND'}`);
        return;
      }

      // Execute emergency exit using Exit Manager
      const exitResult = await exitManager.executeEmergencyExit(
        exitData,
        deltaPosition,
        pi42Position,
        {
          reason: exitData.reason,
          details: exitData.details
        }
      );

      // Log results
      if (exitResult.success) {
        console.log('\n✅ EMERGENCY EXIT COMPLETED SUCCESSFULLY');
        console.log(`   Delta Order ID: ${exitResult.deltaExit.orderId}`);
        console.log(`   Pi42 Order ID: ${exitResult.pi42Exit.orderId}`);
      } else {
        console.error('\n❌ EMERGENCY EXIT FAILED');
        console.error(`   Stage: ${exitResult.stage}`);
        console.error(`   Reason: ${exitResult.reason || 'Unknown'}`);
      }

      // Unregister trade from monitoring
      this.tradeMonitor.unregisterTrade();
      this.activeTrade = null;

      console.log('='.repeat(60));

    } catch (error) {
      console.error('❌ Critical error during emergency exit:', error.message);
      console.error(error.stack);
    }
  }

  /**
   * Handle normal exit after funding (Phase 5)
   * This would typically be triggered by a timer or funding event detection
   */
  async handleNormalExit() {
    try {
      console.log('\n📊 PHASE 5: EXECUTING NORMAL EXIT (POST-FUNDING)');
      console.log('='.repeat(60));

      // if (!this.activeTrade) {
      //   console.error('❌ No active trade to exit');
      //   return;
      // }

      // Get current positions from both exchanges
      const deltaOrderbookRaw = await deltaAPI.getOrderbook(exitData.details.deltaPosition.product_symbol, this.orderbookDepth);
      const deltaOrderbook = positionSizer.normalizeOrderbook(deltaOrderbookRaw, 'delta');
      const deltaSide = exitData.details.deltaPosition.side === 'LONG' ? 'buy' : 'sell';



      const deltaTPResult = positionSizer.calculateTradingPriceFromOrderbook(deltaOrderbook, deltaSide, exitData.details.deltaQuantity);

      const pi42OrderbookRaw = await pi42API.getOrderbook(exitData.details.pi42Position.contractPair, this.orderbookDepth);
      const pi42Orderbook = this.normalizeOrderbook(pi42OrderbookRaw, 'pi42');
      const pi42Side = exitData.details.pi42Position.positionType === 'SHORT' ? 'sell' : 'buy';
      const pi42TPResult = this.calculateTradingPriceFromOrderbook(pi42Orderbook, pi42Side, exitData.details.pi42Quantity);


      const deltaPosition = deltaTPResult.tradingPrice
      const pi42Position = pi42TPResult.tradingPrice


      exitData.position.deltaPosition = deltaPosition;
      exitData.position.pi42Position = pi42Position;

      if (!deltaPosition || !pi42Position) {
        console.error('❌ Could not retrieve positions for exit');
        return;
      }

      // Execute normal exit using Exit Manager
      const exitResult = await exitManager.executeNormalExit(
        exitData,
        deltaPosition,
        pi42Position
      );

      // Log results
      if (exitResult.success) {
        console.log('\n✅ NORMAL EXIT COMPLETED SUCCESSFULLY');
        console.log(`   Exit Type: ${exitResult.type}`);
        console.log(`   Delta Order ID: ${exitResult.deltaExit.orderId}`);
        console.log(`   Pi42 Order ID: ${exitResult.pi42Exit.orderId}`);
      } else {
        console.error('\n❌ NORMAL EXIT FAILED');
        console.error(`   Stage: ${exitResult.stage}`);
        console.error(`   Reason: ${exitResult.reason || 'Unknown'}`);
      }

      // Unregister trade from monitoring
      this.tradeMonitor.unregisterTrade();
      this.activeTrade = null;

      console.log('='.repeat(60));

    } catch (error) {
      console.error('❌ Critical error during normal exit:', error.message);
      console.error(error.stack);
    }
  }

  /**
   * Stop the arbitrage engine
   */
  async stop() {
    console.log('\n🛑 Stopping Arbitrage Engine...');

    this.isRunning = false;

    // Stop trade monitor if running
    if (this.tradeMonitor) {
      this.tradeMonitor.stop();
    }

    // Disconnect exchanges
    this.deltaExchange.disconnect();
    this.pi42Exchange.disconnect();

    // Disconnect services
    await redisService.disconnect();
    await mongoService.disconnect();

    console.log('✅ Arbitrage Engine stopped');
    this.emit('stopped');
  }
}

export default ArbitrageEngine;
