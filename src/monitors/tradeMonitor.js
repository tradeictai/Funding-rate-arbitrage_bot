import EventEmitter from "events";
import DeltaPositionMonitor from "./deltaPositionMonitor.js";
import Pi42PositionMonitor from "./pi42PositionMonitor.js";
import config from "../config/config.js";
import CoinDCXPositionMonitor from "./coindcxPositionMonitor.js";

import deltaAPI from "../services/deltaAPI.js";
import coindcxAPI from "../services/coindcxAPI.js";

/**
 * Trade Monitor - Enhanced Phase 4+
 * - Quantity mismatch check
 * - Real-time Flip Safety (on every update)
 * - Auto Normal Exit at funding time completion
 */
class TradeMonitor extends EventEmitter {
  constructor(deltaExchange, coindcxExchange) {
    super();

    this.deltaMonitor = new DeltaPositionMonitor();
    this.coindcxMonitor = new CoinDCXPositionMonitor();
    // this.conindcxMonitor = new CoinDCXPositionMonitor();

    // Remove dependency on external exchange funding fetchers
    this.deltaExchange = deltaExchange;
    this.coindcxExchange = coindcxExchange;
    // this.coindcxExchange = coindcxExchange;

    this.activeTrade = null;
    this.latestDeltaPosition = null;
    this.latestCoindcxPosition = null;
    this.lockedFundingTime = null;

    this.quantityTolerance = config.trading.quantityTolerance || 0.001; // 5%
    this.minProfitThreshold = config.trading.minProfitThreshold || 0.001; // e.g. 0.01%

    this.liquidationWarningThreshold = 0.03; // 3% from liquidation

    this.bufferPercentForLiquidationProtection =
      config.trading.bufferPercentForLiquidationProtection || 30; // 30%

    this.flipCheckTimer = null;

    this.leverage = config.trading.leverage;

    this.flipExitThresholdPct = config.trading.flipExitThresholdPct || 0.05;

    this.positionCheckInterval = null;
    this.positionVerifyInterval = null;
    this.fundingConfirmedAt = null;
    this.oneSidedDetectedAt = null;

    this.lastRestVerificationTime = 0;
    this.deltaRestMismatchCount = 0;
    this.coindcxRestMismatchCount = 0;
    this.forceDeltaRestVerification = false; // Flag to force REST check after Delta reconnect
    this.lastPositionExistenceCheck = 0; // Throttle position existence checks
    this.exitInProgress = false; // 🔒 Flag to prevent multiple exit triggers

    // 🆕 Per-exchange exit confirmation tracking
    this.deltaExitConfirmed = false; // Track if Delta was intentionally exited
    this.coindcxExitConfirmed = false; // Track if CoinDCX was intentionally exited

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Delta Events
    this.deltaMonitor.on("position", (data) => {
      console.log("Delta position event received:", data);
      this.handleDeltaPosition(data);
    });

    this.deltaMonitor.on("snapshot", (data) => {
      console.log(`📊 Delta snapshot: ${data.count} position(s)`);
      // this.latestDeltaPosition = data.positions[0]
    });

    // ⚠️ Delta reconnecting - may have stale snapshot data
    this.deltaMonitor.on("reconnecting", (data) => {
      console.log("\n⚠️ DELTA WEBSOCKET RECONNECTING");
      console.log("   → May load stale cached positions");
      console.log("   → Will force REST verification to detect manual exits");
      this.forceDeltaRestVerification = true;
    });

    // ⚠️ Delta snapshot on reconnect may contain stale data
    this.deltaMonitor.on("snapshot_received", (data) => {
      if (data.warningFlag === "POTENTIAL_STALE_DATA_ON_RECONNECT") {
        console.log("\n⚠️ DELTA SNAPSHOT RECEIVED (Post-Reconnect)");
        console.log("   → Stale cache from previous session detected");
        console.log("   → Will verify against REST API before trusting");
        this.forceDeltaRestVerification = true;
        this.deltaRestMismatchCount = 0; // Reset counter
      }
    });

    // Pi42 Events
    this.coindcxMonitor.on("position", (data) => {
      console.log("Coindcx position event received:", data);
      this.handleCoindcxPosition(data);
    });

    // Listen to funding rate updates for real-time flip detection
    this.deltaMonitor.on("funding_rate", () => {
      if (this.latestDeltaPosition && this.latestCoindcxPosition) {
        this.performQuantityCheck();
        this.checkForNormalExit();
        this.performFlipCheck();
        this.checkPreLiquidation();
        // Don't check position existence on every funding update - too frequent!
        // It's checked on position updates and by the periodic interval timer
      }
    });

    this.coindcxMonitor.on("funding_rate", () => {
      if (this.latestDeltaPosition && this.latestCoindcxPosition) {
        this.performQuantityCheck();
        this.checkForNormalExit();
        this.performFlipCheck();
        this.checkPreLiquidation();
        // Don't check position existence on every funding update - too frequent!
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔧 POSITION SIZE EXTRACTION (Fixed for actual data structures)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get position size from Delta position
   * Delta uses: size (always positive integer, represents contracts)
   */
  getDeltaPositionSize(position) {
    if (!position) return 0;

    // Delta's size is always positive, represents number of contracts
    const size = Math.abs(parseFloat(position.size || 0));
    const contractValue = parseFloat(position.product?.contract_value || 1);

    return size * contractValue;
  }

  /**
   * Get position size from CoinDCX position
   * CoinDCX uses: size (absolute) or active_pos/positionAmount (signed)
   */
  getCoindcxPositionSize(position) {
    if (!position) return 0;

    // Use 'size' field (absolute value) if available
    if (position.size !== undefined && position.size !== null) {
      return Math.abs(parseFloat(position.size));
    }

    // Fallback to active_pos or positionAmount (can be negative for shorts)
    const size = parseFloat(
      position.active_pos || position.positionAmount || 0,
    );
    return Math.abs(size);
  }

  /**
   * Check if Delta position is active
   */
  hasDeltaPosition() {
    return (
      this.latestDeltaPosition &&
      this.getDeltaPositionSize(this.latestDeltaPosition) > 0
    );
  }

  /**
   * Check if CoinDCX position is active
   */
  hasCoindcxPosition() {
    return (
      this.latestCoindcxPosition &&
      this.getCoindcxPositionSize(this.latestCoindcxPosition) > 0
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔧 POSITION EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════

  async handleDeltaPosition(data) {
    const { type, position } = data;

    console.log(`\n🔔 Delta Position Event: ${type.toUpperCase()}`);

    // Handle delete/close events
    if (type === "delete" || type === "closed" || type === "liquidated") {
      console.log("   ⚠️ Position closed/deleted!");
      this.handleDeltaPositionClosed({ type, position, reason: type });
      return;
    }

    const size = this.getDeltaPositionSize(position);
    const symbol = position.product_symbol;
    const side = position.side;

    console.log(`   Symbol: ${symbol} | Size: ${size} | Side: ${side}`);

    // If size is 0, treat as closed
    if (size === 0) {
      console.log("   ⚠️ Position size is 0 - treating as closed");
      this.handleDeltaPositionClosed({ type: "zero_size", position });
      return;
    }

    this.latestDeltaPosition = position;

    // Run checks if we have both positions
    if (this.latestCoindcxPosition) {
      await this.runAllChecks();
    }

    // Throttle position existence checks - only every 10 seconds
    const now = Date.now();
    if (now - this.lastPositionExistenceCheck > 10000) {
      this.lastPositionExistenceCheck = now;
      this.checkPositionExistence();
    }
  }

  async handleCoindcxPosition(data) {
    const { type, position } = data;

    console.log(`\n🔔 CoinDCX Position Event: ${type.toUpperCase()}`);

    // Handle delete/close events
    if (type === "delete" || type === "closed" || type === "liquidated") {
      console.log("   ⚠️ Position closed/deleted!");
      this.handleCoindcxPositionClosed({ type, position, reason: type });
      return;
    }

    const size = this.getCoindcxPositionSize(position);
    const symbol = position.symbol || position.pair;
    const side = position.side;

    console.log(`   Symbol: ${symbol} | Size: ${size} | Side: ${side}`);

    // If size is 0, treat as closed
    if (size === 0) {
      console.log("   ⚠️ Position size is 0 - treating as closed");
      this.handleCoindcxPositionClosed({ type: "zero_size", position });
      return;
    }

    this.latestCoindcxPosition = position;

    // Run checks if we have both positions
    if (this.latestDeltaPosition) {
      await this.runAllChecks();
    }

    // Throttle position existence checks - only every 10 seconds
    const now = Date.now();
    if (now - this.lastPositionExistenceCheck > 10000) {
      this.lastPositionExistenceCheck = now;
      this.checkPositionExistence();
    }
  }

  /**
   * Run all monitoring checks
   */
  async runAllChecks() {
    await this.performQuantityCheck();
    // await this.checkMarginRatio(); // 🆕 Margin Ratio Safety Check (DISABLED - uncomment to re-enable)
    this.checkPreLiquidation();
    this.performFlipCheck();
    this.checkForNormalExit();
    // Position existence check is throttled and called separately
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔴 POSITION CLOSED HANDLERS
  // ═══════════════════════════════════════════════════════════════

  handleDeltaPositionClosed(data) {
    console.log("\n🔴 DELTA POSITION CLOSED DETECTED");
    console.log("=".repeat(60));
    console.log(`   Reason: ${data.reason || data.type || "unknown"}`);

    // 🔒 CHECK: If exit already in progress, don't trigger another one
    if (this.exitInProgress) {
      console.log(
        "   ⏳ Exit already in progress - skipping position closed handler",
      );
      console.log("   (This position close is expected from ongoing exit)");
      console.log("=".repeat(60));
      return;
    }

    // 🔒 CHECK: If this exchange was already intentionally exited, don't re-trigger
    if (this.deltaExitConfirmed) {
      console.log(
        "   ✅ Delta exit already confirmed - skipping duplicate handler",
      );
      console.log("   (Position close was expected from previous exit)");
      console.log("=".repeat(60));
      return;
    }

    const previousPosition = this.latestDeltaPosition;

    // Don't immediately clear - will verify first
    console.log("   ⚠️ Scheduling double verification in 5 seconds...");
    console.log("   (Waiting to confirm position truly closed)");

    // Clear WebSocket data for now
    this.latestDeltaPosition = null;

    // Schedule verification after short delay to let API catch up
    setTimeout(async () => {
      console.log("\n🔍 VERIFYING DELTA CLOSURE (Double Check)");

      const deltaStillActive = await this.verifyPositionExists("delta");
      const coindcxActive = await this.verifyPositionExists("coindcx");

      if (deltaStillActive) {
        console.log("⚠️ Delta position still active after verification!");
        console.log("   → False WebSocket close event, position restored");
        console.log("=".repeat(60));
        return;
      }

      console.log("✅ Delta position confirmed closed");

      // Check if CoinDCX still has position (one-sided scenario)
      if (coindcxActive) {
        console.log("⚠️ ONE-SIDED: CoinDCX still has position, Delta closed!");

        this.emergencyExit("emergencyExit", {
          reason: "ONE_SIDED_DELTA_CLOSED",
          closedSide: "Delta",
          remainingSide: "CoinDCX",
          closureReason: data.reason || data.type,
          closedPosition: previousPosition,
          deltaPosition: null,
          coindcxPosition: this.latestCoindcxPosition,
          timestamp: new Date().toISOString(),
          doubleVerified: true,
          deltaConfirmed: false,
          coindcxConfirmed: true,
        });
      } else {
        console.log("✅ Both positions closed normally");
      }
      console.log("=".repeat(60));
    }, 5000); // 5 second delay for API to catch up
  }

  handleCoindcxPositionClosed(data) {
    console.log("\n🔴 COINDCX POSITION CLOSED DETECTED");
    console.log("=".repeat(60));
    console.log(`   Reason: ${data.reason || data.type || "unknown"}`);

    // 🔒 CHECK: If exit already in progress, don't trigger another one
    if (this.exitInProgress) {
      console.log(
        "   ⏳ Exit already in progress - skipping position closed handler",
      );
      console.log("   (This position close is expected from ongoing exit)");
      console.log("=".repeat(60));
      return;
    }

    // 🔒 CHECK: If this exchange was already intentionally exited, don't re-trigger
    if (this.coindcxExitConfirmed) {
      console.log(
        "   ✅ CoinDCX exit already confirmed - skipping duplicate handler",
      );
      console.log("   (Position close was expected from previous exit)");
      console.log("=".repeat(60));
      return;
    }

    const previousPosition = this.latestCoindcxPosition;

    // Don't immediately clear - will verify first
    console.log("   ⚠️ Scheduling double verification in 5 seconds...");
    console.log("   (Waiting to confirm position truly closed)");

    // Clear WebSocket data for now
    this.latestCoindcxPosition = null;

    // Schedule verification after short delay to let API catch up
    setTimeout(async () => {
      console.log("\n🔍 VERIFYING COINDCX CLOSURE (Double Check)");

      const coindcxStillActive = await this.verifyPositionExists("coindcx");
      const deltaActive = await this.verifyPositionExists("delta");

      if (coindcxStillActive) {
        console.log("⚠️ CoinDCX position still active after verification!");
        console.log("   → False WebSocket close event, position restored");
        console.log("=".repeat(60));
        return;
      }

      console.log("✅ CoinDCX position confirmed closed");

      // Check if Delta still has position (one-sided scenario)
      if (deltaActive) {
        console.log("⚠️ ONE-SIDED: Delta still has position, CoinDCX closed!");

        this.emergencyExit("emergencyExit", {
          reason: "ONE_SIDED_COINDCX_CLOSED",
          closedSide: "CoinDCX",
          remainingSide: "Delta",
          closureReason: data.reason || data.type,
          closedPosition: previousPosition,
          deltaPosition: this.latestDeltaPosition,
          coindcxPosition: null,
          timestamp: new Date().toISOString(),
          doubleVerified: true,
          deltaConfirmed: true,
          coindcxConfirmed: false,
        });
      } else {
        console.log("✅ Both positions closed normally");
      }
      console.log("=".repeat(60));
    }, 5000); // 5 second delay for API to catch up
  }

  // ═══════════════════════════════════════════════════════════════
  // � MARGIN RATIO SAFETY CHECK (Primary Exit Mechanism)
  // ═══════════════════════════════════════════════════════════════

  /**
   * 💰 MARGIN RATIO SAFETY CHECK
   *
   * Since we use 70% of funds at entry:
   * - Initial margin ratio: ~70%
   * - Exit threshold: 85-90% (before 100% = liquidation)
   * - Monitors BOTH exchanges, exits if EITHER crosses threshold
   *
   * This accounts for:
   * - Unrealized losses reducing available margin
   * - Cross margin (account-wide) AND isolated margin
   * - Multiple positions on same exchange
   */
  async checkMarginRatio() {
    // 🔒 PREVENT MULTIPLE EXIT TRIGGERS
    if (this.exitInProgress) {
      console.log("⏳ Exit already in progress - skipping margin ratio check");
      return false;
    }

    if (!this.latestDeltaPosition || !this.latestCoindcxPosition) {
      console.log("\n💰 MARGIN RATIO SAFETY CHECK - SKIPPED (no positions)");
      return false;
    }

    console.log("\n💰 MARGIN RATIO SAFETY CHECK");
    console.log("━".repeat(70));

    let deltaMarginRatio = 0;
    let coindcxMarginRatio = 0;
    let deltaShouldExit = false;
    let coindcxShouldExit = false;

    // Exit threshold: 85% (leaves 15% buffer before liquidation at 100%)
    const MARGIN_RATIO_EXIT_THRESHOLD = 0.85; // 85%

    // ═══════════════════════════════════════════════════════════════
    // DELTA MARGIN RATIO
    // ═══════════════════════════════════════════════════════════════
    try {
      const deltaWalletData = await deltaAPI.getWalletBalance();

      let deltaBalance = 0;
      let deltaUsedMargin = 0;
      let deltaAvailableMargin = 0;
      let deltaMethod = "unknown";

      if (Array.isArray(deltaWalletData)) {
        const usdtWallet = deltaWalletData.find(
          (w) => w.asset_symbol === "USDT" || w.asset_symbol === "USD",
        );

        if (usdtWallet) {
          // Total balance (equity) - includes unrealized PNL
          deltaBalance = parseFloat(usdtWallet.balance || 0);

          // METHOD 1: Wallet-based calculation (PRIMARY - most reliable)
          // Available balance already accounts for:
          // - Used margin in open positions
          // - Unrealized PNL changes
          // - Maintenance margin requirements
          deltaAvailableMargin = parseFloat(usdtWallet.available_balance || 0);
          deltaUsedMargin = deltaBalance - deltaAvailableMargin;
          deltaMethod = "wallet";

          // METHOD 2: Position-based fallback (if wallet method fails)
          if (deltaBalance === 0 && this.latestDeltaPosition) {
            const positionMargin = parseFloat(
              this.latestDeltaPosition.margin || 0,
            );
            if (positionMargin > 0) {
              deltaUsedMargin = positionMargin;
              // Estimate total balance from position
              const unrealizedPnL = parseFloat(
                this.latestDeltaPosition.unrealized_pnl || 0,
              );
              deltaBalance = positionMargin + unrealizedPnL;
              deltaMethod = "position";
            }
          }
        }
      }

      if (deltaBalance > 0) {
        deltaMarginRatio = deltaUsedMargin / deltaBalance;
        deltaShouldExit = deltaMarginRatio >= MARGIN_RATIO_EXIT_THRESHOLD;

        console.log(`   📊 DELTA MARGIN RATIO (${deltaMethod})`);
        console.log(`   ${"─".repeat(60)}`);
        console.log(
          `   Total Balance (Equity):    $${deltaBalance.toFixed(2)}`,
        );
        console.log(
          `   Used Margin:               $${deltaUsedMargin.toFixed(2)}`,
        );
        console.log(
          `   Available Margin:          $${deltaAvailableMargin.toFixed(2)}`,
        );
        console.log(
          `   Margin Ratio:              ${(deltaMarginRatio * 100).toFixed(2)}%`,
        );
        console.log(
          `   Threshold:                 ${(MARGIN_RATIO_EXIT_THRESHOLD * 100).toFixed(0)}%`,
        );
        console.log(
          `   Status:                    ${deltaShouldExit ? "🔴 DANGER - EXIT!" : "✅ SAFE"}`,
        );
      } else {
        console.log(`   ⚠️ DELTA: Could not fetch wallet balance`);
      }
    } catch (error) {
      console.log(
        `   ⚠️ DELTA: Error fetching margin ratio - ${error.message}`,
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // COINDCX MARGIN RATIO
    // ═══════════════════════════════════════════════════════════════
    try {
      const coindcxWalletData = await coindcxAPI.getAccountBalance();

      let coindcxBalance = 0;
      let coindcxUsedMargin = 0;
      let coindcxAvailableMargin = 0;
      let coindcxMethod = "unknown";

      if (Array.isArray(coindcxWalletData)) {
        const usdtWallet = coindcxWalletData.find(
          (w) => (w.currency_short_name || "").toUpperCase() === "USDT",
        );

        if (usdtWallet) {
          // Total balance (equity) - includes unrealized PNL
          coindcxBalance = parseFloat(usdtWallet.balance || 0);

          // METHOD 1: Wallet-based calculation (PRIMARY - most reliable)
          // CoinDCX returns cross_user_margin (used margin) instead of available_balance
          // Available = balance - cross_user_margin
          const crossUserMargin = parseFloat(usdtWallet.cross_user_margin || 0);
          coindcxUsedMargin = crossUserMargin;
          coindcxAvailableMargin = coindcxBalance - coindcxUsedMargin;
          coindcxMethod = "wallet";

          // METHOD 2: Position-based fallback (if wallet method fails)
          if (coindcxBalance === 0 && this.latestCoindcxPosition) {
            // CoinDCX position margin calculation
            const size = Math.abs(
              parseFloat(
                this.latestCoindcxPosition.size ||
                  this.latestCoindcxPosition.active_pos ||
                  this.latestCoindcxPosition.positionAmount ||
                  0,
              ),
            );
            const entryPrice = parseFloat(
              this.latestCoindcxPosition.avg_price || 0,
            );
            const leverage = parseFloat(
              this.latestCoindcxPosition.leverage || 10,
            );

            if (size > 0 && entryPrice > 0) {
              const positionValue = size * entryPrice;
              coindcxUsedMargin = positionValue / leverage;

              const unrealizedPnL = parseFloat(
                this.latestCoindcxPosition.unrealised_pnl ||
                  this.latestCoindcxPosition.unrealisedPnl ||
                  this.latestCoindcxPosition.pnl ||
                  0,
              );
              coindcxBalance = coindcxUsedMargin + unrealizedPnL;
              coindcxMethod = "position";
            }
          }
        }
      }

      if (coindcxBalance > 0) {
        coindcxMarginRatio = coindcxUsedMargin / coindcxBalance;
        coindcxShouldExit = coindcxMarginRatio >= MARGIN_RATIO_EXIT_THRESHOLD;

        console.log(`\n   📊 COINDCX MARGIN RATIO (${coindcxMethod})`);
        console.log(`   ${"─".repeat(60)}`);
        console.log(
          `   Total Balance (Equity):    $${coindcxBalance.toFixed(2)}`,
        );
        console.log(
          `   Used Margin:               $${coindcxUsedMargin.toFixed(2)}`,
        );
        console.log(
          `   Available Margin:          $${coindcxAvailableMargin.toFixed(2)}`,
        );
        console.log(
          `   Margin Ratio:              ${(coindcxMarginRatio * 100).toFixed(2)}%`,
        );
        console.log(
          `   Threshold:                 ${(MARGIN_RATIO_EXIT_THRESHOLD * 100).toFixed(0)}%`,
        );
        console.log(
          `   Status:                    ${coindcxShouldExit ? "🔴 DANGER - EXIT!" : "✅ SAFE"}`,
        );
      } else {
        console.log(`   ⚠️ COINDCX: Could not fetch wallet balance`);
      }
    } catch (error) {
      console.log(
        `   ⚠️ COINDCX: Error fetching margin ratio - ${error.message}`,
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // TRIGGER EXIT IF NEEDED
    // ═══════════════════════════════════════════════════════════════
    if (deltaShouldExit || coindcxShouldExit) {
      const triggeringSide = deltaShouldExit ? "Delta" : "CoinDCX";
      const triggeringRatio = deltaShouldExit
        ? deltaMarginRatio
        : coindcxMarginRatio;

      console.log("\n   🚨🚨🚨 MARGIN RATIO EXIT TRIGGERED 🚨🚨🚨");
      console.log("   " + "=".repeat(60));
      console.log(`   Triggering Side:       ${triggeringSide}`);
      console.log(
        `   Margin Ratio:          ${(triggeringRatio * 100).toFixed(2)}%`,
      );
      console.log(
        `   Threshold:             ${(MARGIN_RATIO_EXIT_THRESHOLD * 100).toFixed(0)}%`,
      );
      console.log(`   `);
      console.log(
        `   📍 REASON: Margin ratio exceeded ${(MARGIN_RATIO_EXIT_THRESHOLD * 100).toFixed(0)}% threshold`,
      );
      console.log(
        `   📍 MATLAB: Account approaching liquidation - protecting funds!`,
      );
      console.log(`   📍 ACTION: EXIT to preserve remaining margin`);
      console.log("   " + "=".repeat(60));

      // DOUBLE VERIFICATION before exit
      console.log("\n🔄 DOUBLE VERIFICATION BEFORE MARGIN EXIT...");
      console.log("─".repeat(60));
      const deltaConfirmed = await this.verifyPositionExists("delta");
      const coindcxConfirmed = await this.verifyPositionExists("coindcx");

      console.log("📊 VERIFICATION RESULTS:");
      console.log(`   Delta: ${deltaConfirmed ? "✅ Active" : "❌ Closed"}`);
      console.log(
        `   CoinDCX: ${coindcxConfirmed ? "✅ Active" : "❌ Closed"}`,
      );
      console.log("─".repeat(60));

      if (!deltaConfirmed && !coindcxConfirmed) {
        console.log("✅ Both positions already closed - no exit needed");
        this.resetFundingState();
        return true;
      }

      // 🔒 SET FLAG TO PREVENT MULTIPLE TRIGGERS
      this.exitInProgress = true;
      console.log("🔒 Exit lock acquired - preventing duplicate triggers");

      this.emergencyExit("MARGIN_RATIO_EXIT", {
        reason: "MARGIN_RATIO_EXCEEDED",
        triggeringSide,
        threshold: MARGIN_RATIO_EXIT_THRESHOLD,

        // Delta
        deltaMarginRatio,
        deltaShouldExit,

        // CoinDCX
        coindcxMarginRatio,
        coindcxShouldExit,

        // Positions
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition,
        timestamp: new Date().toISOString(),
        doubleVerified: true,
        deltaConfirmed,
        coindcxConfirmed,
      });

      this.resetFundingState();
      return true;
    }

    console.log(`\n   ✅ MARGIN RATIOS SAFE ON BOTH EXCHANGES`);
    console.log(
      `   Both below ${(MARGIN_RATIO_EXIT_THRESHOLD * 100).toFixed(0)}% threshold - HOLD positions`,
    );
    console.log("━".repeat(70));

    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // �🛡️ PRE-LIQUIDATION CHECK (3% threshold)
  // ═══════════════════════════════════════════════════════════════

  /**
   * 🛡️ LIQUIDATION PROTECTION CHECK
   * Leverage position data se dynamically extract hota hai
   */
  /**
   * 🛡️ LIQUIDATION PROTECTION CHECK - SIMPLE PRICE COMPARISON
   *
   * Logic:
   * 1. Difference = |Liquidation Price - Entry Price|
   * 2. Buffer Amount = Difference × 10%
   * 3. Exit Threshold Price = Liq Price ± Buffer (based on side)
   * 4. Compare Mark Price with Exit Threshold Price
   * 5. If crossed → EXIT!
   */
  async checkPreLiquidation() {
    // 🔒 PREVENT MULTIPLE EXIT TRIGGERS
    if (this.exitInProgress) {
      console.log("⏳ Exit already in progress - skipping liquidation check");
      return false;
    }

    if (!this.latestDeltaPosition || !this.latestCoindcxPosition) return false;

    // ─── PATCH FRESH MARK PRICES FROM LIVE TICKER STREAMS ───────────────────────
    // latestDeltaPosition.mark_price only updates when Delta's positions WS fires
    // (infrequent). Use the per-second v2/ticker cache from deltaMonitor instead.
    const deltaSymbol = this.latestDeltaPosition.product_symbol;
    const freshDeltaMarkPrice = this.deltaMonitor.getMarkPrice(deltaSymbol);
    if (freshDeltaMarkPrice && freshDeltaMarkPrice > 0) {
      this.latestDeltaPosition = {
        ...this.latestDeltaPosition,
        mark_price: String(freshDeltaMarkPrice),
      };
    }

    // latestCoindcxPosition.mark_price is whatever the last position WS event
    // carried. Overwrite with the per-second Binance !markPrice@arr cache.
    const coindcxSymbol =
      this.latestCoindcxPosition.symbol || this.latestCoindcxPosition.pair;
    const freshCoindcxMarkPrice =
      this.coindcxMonitor.getMarkPrice(coindcxSymbol);
    if (freshCoindcxMarkPrice && freshCoindcxMarkPrice > 0) {
      this.latestCoindcxPosition = {
        ...this.latestCoindcxPosition,
        mark_price: freshCoindcxMarkPrice,
      };
    }
    // ─────────────────────────────────────────────────────────────────────────────

    // 🔴 30% buffer rakhna hai liquidation se pehle
    // const bufferPercent = 30;
    const bufferPercent = this.bufferPercentForLiquidationProtection;

    const deltaLeverage = this.leverage || 10;
    const coindcxLeverage = this.leverage || 10;

    console.log("\n🛡️ LIQUIDATION PROTECTION CHECK (PRICE BASED)");
    console.log("━".repeat(70));
    console.log(`   Delta Leverage:   ${deltaLeverage}x`);
    console.log(`   CoinDCX Leverage: ${coindcxLeverage}x`);
    console.log(
      `   Buffer:           ${bufferPercent}% (Liq se ${bufferPercent}% pehle exit)`,
    );
    console.log("");

    // Calculate for Delta
    const deltaResult = this.calculateExitThresholdPrice(
      this.latestDeltaPosition,
      "delta",
      bufferPercent,
      deltaLeverage,
    );

    // Calculate for CoinDCX
    const coindcxResult = this.calculateExitThresholdPrice(
      this.latestCoindcxPosition,
      "coindcx",
      bufferPercent,
      coindcxLeverage,
    );

    // ═══════════════════════════════════════════════════════════════
    // DELTA POSITION LOG
    // ═══════════════════════════════════════════════════════════════
    console.log(
      `   📊 DELTA (${deltaResult.side}) - ${deltaLeverage}x Leverage`,
    );
    console.log(`   ${"─".repeat(60)}`);
    console.log(
      `   Entry Price:           $${deltaResult.entryPrice.toFixed(8)}`,
    );
    console.log(
      `   Liquidation Price:     $${deltaResult.liquidationPrice.toFixed(8)}`,
    );
    console.log(
      `   Difference:            $${deltaResult.difference.toFixed(8)} (${deltaResult.differencePercent.toFixed(4)}%)`,
    );
    console.log(
      `   Buffer Amount (${bufferPercent}%):   $${deltaResult.bufferAmount.toFixed(8)}`,
    );
    console.log(
      `   Exit Threshold Price:  $${deltaResult.exitThresholdPrice.toFixed(8)} ← EXIT agar cross ho`,
    );
    console.log(
      `   Current Mark Price:    $${deltaResult.markPrice.toFixed(8)}`,
    );
    console.log(
      `   Distance to Exit:      $${deltaResult.distanceToExit.toFixed(8)} (${deltaResult.distanceToExitPercent.toFixed(4)}%)`,
    );

    if (deltaResult.side === "LONG") {
      console.log(
        `   Condition:             Mark ($${deltaResult.markPrice.toFixed(8)}) ${deltaResult.shouldExit ? "≤" : ">"} Exit ($${deltaResult.exitThresholdPrice.toFixed(8)})`,
      );
    } else {
      console.log(
        `   Condition:             Mark ($${deltaResult.markPrice.toFixed(8)}) ${deltaResult.shouldExit ? "≥" : "<"} Exit ($${deltaResult.exitThresholdPrice.toFixed(8)})`,
      );
    }
    console.log(
      `   Status:                ${deltaResult.shouldExit ? "🔴 EXIT KARO!" : "✅ SAFE - HOLD"}`,
    );

    // ═══════════════════════════════════════════════════════════════
    // COINDCX POSITION LOG
    // ═══════════════════════════════════════════════════════════════
    console.log(
      `\n   📊 COINDCX (${coindcxResult.side}) - ${coindcxLeverage}x Leverage`,
    );
    console.log(`   ${"─".repeat(60)}`);
    console.log(
      `   Entry Price:           $${coindcxResult.entryPrice.toFixed(8)}`,
    );
    console.log(
      `   Liquidation Price:     $${coindcxResult.liquidationPrice.toFixed(8)}`,
    );
    console.log(
      `   Difference:            $${coindcxResult.difference.toFixed(8)} (${coindcxResult.differencePercent.toFixed(4)}%)`,
    );
    console.log(
      `   Buffer Amount (${bufferPercent}%):   $${coindcxResult.bufferAmount.toFixed(8)}`,
    );
    console.log(
      `   Exit Threshold Price:  $${coindcxResult.exitThresholdPrice.toFixed(8)} ← EXIT agar cross ho`,
    );
    console.log(
      `   Current Mark Price:    $${coindcxResult.markPrice.toFixed(8)}`,
    );
    console.log(
      `   Distance to Exit:      $${coindcxResult.distanceToExit.toFixed(8)} (${coindcxResult.distanceToExitPercent.toFixed(4)}%)`,
    );

    if (coindcxResult.side === "LONG") {
      console.log(
        `   Condition:             Mark ($${coindcxResult.markPrice.toFixed(8)}) ${coindcxResult.shouldExit ? "≤" : ">"} Exit ($${coindcxResult.exitThresholdPrice.toFixed(8)})`,
      );
    } else {
      console.log(
        `   Condition:             Mark ($${coindcxResult.markPrice.toFixed(8)}) ${coindcxResult.shouldExit ? "≥" : "<"} Exit ($${coindcxResult.exitThresholdPrice.toFixed(8)})`,
      );
    }
    console.log(
      `   Status:                ${coindcxResult.shouldExit ? "🔴 EXIT KARO!" : "✅ SAFE - HOLD"}`,
    );

    // ═══════════════════════════════════════════════════════════════
    // COMBINED SUMMARY
    // ═══════════════════════════════════════════════════════════════
    console.log(`\n   📊 SUMMARY`);
    console.log(`   ${"─".repeat(60)}`);
    console.log(
      `   Delta:   Mark $${deltaResult.markPrice.toFixed(8)} | Exit Threshold $${deltaResult.exitThresholdPrice.toFixed(8)} → ${deltaResult.shouldExit ? "🔴 EXIT" : "✅ HOLD"}`,
    );
    console.log(
      `   CoinDCX: Mark $${coindcxResult.markPrice.toFixed(8)} | Exit Threshold $${coindcxResult.exitThresholdPrice.toFixed(8)} → ${coindcxResult.shouldExit ? "🔴 EXIT" : "✅ HOLD"}`,
    );

    // ═══════════════════════════════════════════════════════════════
    // TRIGGER EXIT IF NEEDED
    // ═══════════════════════════════════════════════════════════════
    if (deltaResult.shouldExit || coindcxResult.shouldExit) {
      const triggeringSide = deltaResult.shouldExit ? "Delta" : "CoinDCX";
      const triggeringResult = deltaResult.shouldExit
        ? deltaResult
        : coindcxResult;
      const triggeringLeverage = deltaResult.shouldExit
        ? deltaLeverage
        : coindcxLeverage;

      console.log("\n   🚨🚨🚨 LIQUIDATION PROTECTION EXIT TRIGGERED 🚨🚨🚨");
      console.log("   " + "=".repeat(60));
      console.log(`   Triggering Side:       ${triggeringSide}`);
      console.log(`   Position Type:         ${triggeringResult.side}`);
      console.log(`   Leverage:              ${triggeringLeverage}x`);
      console.log(
        `   Entry Price:           $${triggeringResult.entryPrice.toFixed(8)}`,
      );
      console.log(
        `   Liquidation Price:     $${triggeringResult.liquidationPrice.toFixed(8)}`,
      );
      console.log(
        `   Exit Threshold Price:  $${triggeringResult.exitThresholdPrice.toFixed(8)}`,
      );
      console.log(
        `   Current Mark Price:    $${triggeringResult.markPrice.toFixed(8)}`,
      );
      console.log(`   `);

      if (triggeringResult.side === "LONG") {
        console.log(
          `   📍 REASON: Mark Price ($${triggeringResult.markPrice.toFixed(8)}) ≤ Exit Threshold ($${triggeringResult.exitThresholdPrice.toFixed(8)})`,
        );
      } else {
        console.log(
          `   📍 REASON: Mark Price ($${triggeringResult.markPrice.toFixed(8)}) ≥ Exit Threshold ($${triggeringResult.exitThresholdPrice.toFixed(8)})`,
        );
      }
      console.log(
        `   📍 MATLAB: Price ne ${bufferPercent}% buffer zone cross kar diya!`,
      );
      console.log(`   📍 ACTION: EXIT to avoid liquidation & fees`);
      console.log("   " + "=".repeat(60));

      // 🔒 SET FLAG IMMEDIATELY before any await — prevents race condition.
      // Two concurrent callers (e.g. two simultaneous funding-rate events) can both
      // pass the top-of-function exitInProgress guard before either yields, because
      // JavaScript only interleaves at await points. By setting the flag here
      // (no await above this point within the shouldExit block) the second caller
      // will be blocked on the next event-loop tick when it checks at the top.
      this.exitInProgress = true;
      console.log("🔒 Exit lock acquired - preventing duplicate triggers");

      // DOUBLE VERIFICATION before exit (same as one-sided exit)
      console.log("\n🔄 DOUBLE VERIFICATION BEFORE LIQUIDATION EXIT...");
      console.log("─".repeat(60));
      const deltaConfirmed = await this.verifyPositionExists("delta");
      const coindcxConfirmed = await this.verifyPositionExists("coindcx");

      console.log("📊 VERIFICATION RESULTS:");
      console.log(`   Delta: ${deltaConfirmed ? "✅ Active" : "❌ Closed"}`);
      console.log(
        `   CoinDCX: ${coindcxConfirmed ? "✅ Active" : "❌ Closed"}`,
      );
      console.log("─".repeat(60));

      if (!deltaConfirmed && !coindcxConfirmed) {
        console.log("✅ Both positions already closed - no exit needed");
        this.exitInProgress = false; // Reset so future liquidation checks run normally
        this.resetFundingState();
        return true;
      }

      this.emergencyExit("emergencyExit", {
        reason: "LIQUIDATION_PROTECTION",
        triggeringSide,
        bufferPercent,

        // Delta
        deltaLeverage,
        deltaEntryPrice: deltaResult.entryPrice,
        deltaMarkPrice: deltaResult.markPrice,
        deltaLiqPrice: deltaResult.liquidationPrice,
        deltaExitThresholdPrice: deltaResult.exitThresholdPrice,
        deltaDifference: deltaResult.difference,
        deltaBufferAmount: deltaResult.bufferAmount,
        deltaSide: deltaResult.side,
        deltaShouldExit: deltaResult.shouldExit,

        // CoinDCX
        coindcxLeverage,
        coindcxEntryPrice: coindcxResult.entryPrice,
        coindcxMarkPrice: coindcxResult.markPrice,
        coindcxLiqPrice: coindcxResult.liquidationPrice,
        coindcxExitThresholdPrice: coindcxResult.exitThresholdPrice,
        coindcxDifference: coindcxResult.difference,
        coindcxBufferAmount: coindcxResult.bufferAmount,
        coindcxSide: coindcxResult.side,
        coindcxShouldExit: coindcxResult.shouldExit,

        // Positions (use latest verified data)
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition,
        timestamp: new Date().toISOString(),
        doubleVerified: true,
        deltaConfirmed,
        coindcxConfirmed,
      });

      this.resetFundingState();
      return true;
    }

    console.log(`\n   ✅ DONO POSITIONS SAFE HAIN`);
    console.log(`   Mark Price exit threshold se door hai - HOLD karo`);
    console.log("━".repeat(70));

    return false;
  }

  /**
   * Calculate Exit Threshold Price
   *
   * Formula:
   * - Difference = |Liquidation Price - Entry Price|
   * - Buffer Amount = Difference × (bufferPercent / 100)
   * - For LONG: Exit Threshold = Liquidation Price + Buffer Amount
   * - For SHORT: Exit Threshold = Liquidation Price - Buffer Amount
   *
   * Exit Condition:
   * - For LONG: Mark Price ≤ Exit Threshold → EXIT
   * - For SHORT: Mark Price ≥ Exit Threshold → EXIT
   */
  calculateExitThresholdPrice(position, exchange, bufferPercent, leverage) {
    const defaultResult = {
      entryPrice: 0,
      markPrice: 0,
      liquidationPrice: 0,
      difference: 0,
      differencePercent: 0,
      bufferAmount: 0,
      exitThresholdPrice: 0,
      distanceToExit: 0,
      distanceToExitPercent: 0,
      side: "UNKNOWN",
      leverage: leverage,
      shouldExit: false,
    };

    if (!position) return defaultResult;

    let entryPrice, markPrice, liquidationPrice, side;

    // ═══════════════════════════════════════════════════════════════
    // EXTRACT POSITION DATA
    // ═══════════════════════════════════════════════════════════════
    if (exchange === "delta") {
      entryPrice = parseFloat(position.entry_price || 0);
      markPrice = parseFloat(position.mark_price || 0);
      liquidationPrice = parseFloat(position.liquidation_price || 0);
      side = (position.side || "").toUpperCase();
    } else {
      entryPrice = parseFloat(position.avg_price || 0);
      markPrice = parseFloat(position.mark_price || 0);
      liquidationPrice = parseFloat(position.liquidation_price || 0);
      side = (position.side || "").toUpperCase();

      // CoinDCX crossed margin ke liye calculate karo if not provided
      if (liquidationPrice === 0 && entryPrice > 0) {
        const maintenanceMarginRate = 0.004;

        if (side === "SHORT") {
          liquidationPrice =
            entryPrice * (1 + 1 / leverage - maintenanceMarginRate);
        } else if (side === "LONG") {
          liquidationPrice =
            entryPrice * (1 - 1 / leverage + maintenanceMarginRate);
        }

        console.log(
          `   ℹ️ CoinDCX: Calculated Liq Price: $${liquidationPrice.toFixed(8)} (${leverage}x)`,
        );
      }
    }

    // Validate data
    if (!entryPrice || !markPrice || !liquidationPrice) {
      console.log(`   ⚠️ ${exchange}: Missing prices`);
      return {
        ...defaultResult,
        entryPrice,
        markPrice,
        liquidationPrice,
        side,
        leverage,
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Calculate Difference = |Liquidation Price - Entry Price|
    // ═══════════════════════════════════════════════════════════════
    const difference = Math.abs(liquidationPrice - entryPrice);
    const differencePercent = (difference / entryPrice) * 100;

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Calculate Buffer Amount = Difference × (bufferPercent / 100)
    // ═══════════════════════════════════════════════════════════════
    const bufferAmount = difference * (bufferPercent / 100);

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Calculate Exit Threshold Price
    // - For LONG: Exit Threshold = Liq Price + Buffer (above liq)
    // - For SHORT: Exit Threshold = Liq Price - Buffer (below liq)
    // ═══════════════════════════════════════════════════════════════
    let exitThresholdPrice;
    let shouldExit = false;
    let distanceToExit = 0;

    if (side === "LONG") {
      // LONG: Liquidation is BELOW entry
      // Exit Threshold = Liq Price + Buffer Amount
      exitThresholdPrice = liquidationPrice + bufferAmount;

      // Exit Condition: Mark Price ≤ Exit Threshold
      shouldExit = markPrice <= exitThresholdPrice;
      // shouldExit = 0.0060033 <= exitThresholdPrice;  // markPrice <= exitThresholdPrice;

      // Distance to exit (positive = safe, negative = should have exited)
      distanceToExit = markPrice - exitThresholdPrice;
      // distanceToExit = 0.0060033- exitThresholdPrice; // markPrice - exitThresholdPrice;
    } else if (side === "SHORT") {
      // SHORT: Liquidation is ABOVE entry
      // Exit Threshold = Liq Price - Buffer Amount
      exitThresholdPrice = liquidationPrice - bufferAmount;

      // Exit Condition: Mark Price ≥ Exit Threshold
      shouldExit = markPrice >= exitThresholdPrice;

      // Distance to exit (positive = safe, negative = should have exited)
      distanceToExit = exitThresholdPrice - markPrice;
    } else {
      console.log(`   ⚠️ ${exchange}: Unknown side "${side}"`);
      return {
        ...defaultResult,
        entryPrice,
        markPrice,
        liquidationPrice,
        side,
        leverage,
      };
    }

    const distanceToExitPercent = (distanceToExit / entryPrice) * 100;

    return {
      entryPrice,
      markPrice,
      liquidationPrice,
      difference,
      differencePercent,
      bufferAmount,
      exitThresholdPrice,
      distanceToExit,
      distanceToExitPercent,
      side,
      leverage,
      shouldExit,
    };
  }
  /**
   * Calculate liquidation risk for Delta position
   * Delta provides liquidation_price as STRING
   */
  calculateDeltaLiquidationRisk(position) {
    const markPrice = parseFloat(position.mark_price || 0);
    const liquidationPrice = parseFloat(position.liquidation_price || 0); // STRING in your data!
    const side = position.side; // 'LONG' or 'SHORT'
    const entryPrice = parseFloat(position.entry_price || 0);

    if (!markPrice || !liquidationPrice) {
      console.log(
        `   ⚠️ Delta: Missing mark_price (${markPrice}) or liquidation_price (${liquidationPrice})`,
      );
      return {
        shouldExit: false,
        distancePercent: 100,
        markPrice: markPrice || 0,
        liquidationPrice: liquidationPrice || 0,
        side,
        entryPrice,
      };
    }

    // Calculate distance from mark price to liquidation price
    let distancePercent;

    if (side === "LONG") {
      // For LONG: liquidation is BELOW mark price
      // Distance = (markPrice - liquidationPrice) / markPrice * 100
      distancePercent = ((markPrice - liquidationPrice) / markPrice) * 100;
    } else {
      // For SHORT: liquidation is ABOVE mark price
      // Distance = (liquidationPrice - markPrice) / markPrice * 100
      distancePercent = ((liquidationPrice - markPrice) / markPrice) * 100;
    }

    console.log(
      `   ℹ️ Delta: Mark Price: $${markPrice}, Liq Price: $${liquidationPrice}, Distance: ${distancePercent.toFixed(4)}%`,
    );

    // If distance is negative, we're already past liquidation (shouldn't happen)
    if (distancePercent < 0) {
      console.log(`   🔴 Delta: PAST LIQUIDATION PRICE!`);
      return {
        shouldExit: true,
        distancePercent: 0,
        markPrice,
        liquidationPrice,
        side,
        entryPrice,
      };
    }

    const shouldExit =
      distancePercent <= this.liquidationWarningThreshold * 100;

    return {
      shouldExit,
      distancePercent,
      markPrice,
      liquidationPrice,
      side,
      entryPrice,
    };
  }

  /**
   * Calculate liquidation risk for CoinDCX position
   * CoinDCX may have liquidation_price = 0 for crossed margin!
   */
  calculateCoindcxLiquidationRisk(position) {
    const markPrice = parseFloat(position.mark_price || 0);
    let liquidationPrice = parseFloat(position.liquidation_price || 0);
    const side = position.side; // 'LONG' or 'SHORT'
    const entryPrice = parseFloat(position.avg_price || 0);
    const leverage = parseFloat(position.leverage || 10);
    const marginType = position.margin_type; // 'crossed' or 'isolated'

    // For crossed margin, liquidation_price might be 0 - we need to calculate it
    if (liquidationPrice === 0 && entryPrice > 0) {
      console.log(
        `   ℹ️ CoinDCX: Calculating liquidation price (crossed margin)`,
      );

      // Approximate liquidation price calculation
      // For isolated margin: liq_price ≈ entry * (1 ± 1/leverage)
      // For crossed margin: this is more complex, use conservative estimate

      const maintenanceMarginRate = 0.004; // 0.4% typical for CoinDCX

      if (side === "SHORT") {
        // Short liquidation: price goes UP
        // liq_price ≈ entry * (1 + 1/leverage - maintenanceMarginRate)
        liquidationPrice =
          entryPrice * (1 + 1 / leverage - maintenanceMarginRate);
      } else {
        // Long liquidation: price goes DOWN
        // liq_price ≈ entry * (1 - 1/leverage + maintenanceMarginRate)
        liquidationPrice =
          entryPrice * (1 - 1 / leverage + maintenanceMarginRate);
      }

      console.log(
        `   ℹ️ Calculated Liq Price: $${liquidationPrice.toFixed(8)}`,
      );
    }

    if (!markPrice) {
      console.log(`   ⚠️ CoinDCX: Missing mark_price`);
      return {
        shouldExit: false,
        distancePercent: 100,
        markPrice: 0,
        liquidationPrice,
        side,
        entryPrice,
        leverage,
        marginType,
      };
    }

    // Calculate distance from mark price to liquidation price
    let distancePercent;

    if (side === "LONG") {
      // For LONG: liquidation is BELOW mark price
      distancePercent = ((markPrice - liquidationPrice) / markPrice) * 100;
    } else {
      // For SHORT: liquidation is ABOVE mark price
      distancePercent = ((liquidationPrice - markPrice) / markPrice) * 100;
    }

    console.log(
      `   ℹ️ CoinDCX: Mark Price: $${markPrice}, Liq Price: $${liquidationPrice}, Distance: ${distancePercent.toFixed(4)}%`,
    );
    // If distance is negative, we're past liquidation
    if (distancePercent < 0) {
      console.log(`   🔴 CoinDCX: PAST LIQUIDATION PRICE!`);
      return {
        shouldExit: true,
        distancePercent: 0,
        markPrice,
        liquidationPrice,
        side,
        entryPrice,
        leverage,
        marginType,
      };
    }

    const shouldExit =
      distancePercent <= this.liquidationWarningThreshold * 100;

    return {
      shouldExit,
      distancePercent,
      markPrice,
      liquidationPrice,
      side,
      entryPrice,
      leverage,
      marginType,
    };
  }

  async performQuantityCheck() {
    const deltaPosition = this.latestDeltaPosition;
    const coindcxPosition = this.latestCoindcxPosition;

    if (!deltaPosition || !coindcxPosition) return;

    const deltaSize = Math.abs(deltaPosition.size || 0);
    const deltaContractValue = parseFloat(
      deltaPosition.product?.contract_value || 1,
    );
    const deltaQuantity = deltaSize * deltaContractValue;

    // Use robust CoinDCX size extraction (active_pos/size/positionAmount)
    const coindcxSize = this.getCoindcxPositionSize(coindcxPosition);
    const coindcxQuantity = Math.abs(coindcxSize || 0);

    console.log("\n🔍 QUANTITY CHECK");
    console.log("=".repeat(60));
    console.log(
      `Delta: ${deltaQuantity.toFixed(
        4,
      )} (${deltaSize} × ${deltaContractValue})`,
    );
    console.log(`Coindcx:  ${coindcxQuantity.toFixed(4)}`);

    const maxQty = Math.max(deltaQuantity, coindcxQuantity);
    const qtyDiff = Math.abs(deltaQuantity - coindcxQuantity);
    const qtyDiffPct = maxQty > 0 ? (qtyDiff / maxQty) * 100 : 0;

    console.log(
      `Difference: ${qtyDiff.toFixed(4)} (${qtyDiffPct.toFixed(
        2,
      )}%) | Tolerance: ${(this.quantityTolerance * 100).toFixed(1)}%`,
    );

    // 🚨 GUARD: Skip emergency exit if one position is 0 (delayed WebSocket snapshot)
    // This prevents false exits when one exchange's WS snapshot hasn't arrived yet
    const hasZeroPosition = deltaQuantity === 0 || coindcxQuantity === 0;

    if (qtyDiffPct > this.quantityTolerance * 100) {
      if (hasZeroPosition) {
        // One position missing from WS, likely just delayed snapshot
        console.log(
          "⚠️  QUANTITY ZERO DETECTED (likely delayed WebSocket snapshot)",
        );
        console.log(`   Delta: ${deltaQuantity} | CoinDCX: ${coindcxQuantity}`);
        console.log(
          "   → Waiting for REST verification to backfill missing data",
        );
        console.log(
          "   → Emergency exit SKIPPED (not a real mismatch, just stale WS)",
        );

        // Force immediate REST verification instead of waiting for the interval
        await this.verifyPositionsViaREST(true);
      } else {
        // Both positions have non-zero sizes but differ significantly
        console.log("❌ QUANTITY MISMATCH → EMERGENCY EXIT");
        console.log(
          `   Delta: ${deltaQuantity.toFixed(4)} | CoinDCX: ${coindcxQuantity.toFixed(4)}`,
        );
        console.log(
          `   Mismatch: ${qtyDiffPct.toFixed(2)}% (tolerance: ${(this.quantityTolerance * 100).toFixed(1)}%)`,
        );

        // Emit event for dashboard
        this.emit("quantityMismatch", {
          deltaQty: deltaQuantity,
          coindcxQty: coindcxQuantity,
          differencePct: qtyDiffPct,
          deltaPosition,
          coindcxPosition,
        });

        await this.emergencyExit("QUANTITY_MISMATCH", {
          reason: `Quantity mismatch exceeds ${
            this.quantityTolerance * 100
          }% tolerance`,
          deltaQuantity,
          coindcxQuantity,
          qtyDiffPct,
          deltaPosition,
          coindcxPosition,
        });
      }
    } else {
      console.log("✅ Quantity check passed");
    }
    console.log("=".repeat(60));
  }

  performFlipCheck() {
    // Skip if no positions or exit already in progress
    if (
      !this.latestDeltaPosition ||
      !this.latestCoindcxPosition ||
      this.exitInProgress
    ) {
      return;
    }

    // Get funding rates using the same sources as opportunity scanning
    const deltaSymbol = this.latestDeltaPosition.product_symbol;
    const coindcxSymbol =
      this.latestCoindcxPosition.symbol ||
      this.latestCoindcxPosition.contractPair;

    const deltaFundingData = this.deltaExchange?.getFundingData(deltaSymbol);
    const binanceSymbol = this.coindcxMonitor.coindcxToBinance(coindcxSymbol);
    const coindcxFundingData =
      this.coindcxExchange?.getFundingData(binanceSymbol);

    let FR_delta = deltaFundingData?.fundingRate;
    let FR_coindcx = coindcxFundingData?.fundingRate;

    const isInvalidRate = (rate) =>
      rate === null || rate === undefined || Number.isNaN(rate);

    // Fallback to monitor rates if exchange sources are missing
    if (isInvalidRate(FR_delta) || isInvalidRate(FR_coindcx)) {
      const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
      const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);
      FR_delta = !isInvalidRate(deltaFRData?.rate)
        ? deltaFRData.rate
        : FR_delta;
      FR_coindcx = !isInvalidRate(coindcxFRData?.rate)
        ? coindcxFRData.rate
        : FR_coindcx;
    }

    // Wait for both funding rates to be available
    if (isInvalidRate(FR_delta) || isInvalidRate(FR_coindcx)) {
      return;
    }

    console.log(
      `🔎 Flip FR sources | Delta ${deltaSymbol}: ${FR_delta.toFixed(4)}% | Binance ${binanceSymbol}: ${FR_coindcx.toFixed(4)}%`,
    );

    // Determine which rate is LONG (higher absolute) and which is SHORT (lower absolute)
    let FR_long, FR_short, exchange_long, exchange_short;
    if (Math.abs(FR_delta) >= Math.abs(FR_coindcx)) {
      FR_long = FR_delta;
      FR_short = FR_coindcx;
      exchange_long = "Delta";
      exchange_short = "CoinDCX";
    } else {
      FR_long = FR_coindcx;
      FR_short = FR_delta;
      exchange_long = "CoinDCX";
      exchange_short = "Delta";
    }

    // Calculate funding rate difference: |FR_long| - |FR_short|
    const fundingDiff = this.calculateFundingDifference(FR_long, FR_short);

    console.log("\n🔄 FLIP SAFETY CHECK");
    console.log("─".repeat(60));
    console.log(`Delta FR:        ${FR_delta.toFixed(4)}%`);
    console.log(`CoinDCX FR:      ${FR_coindcx.toFixed(4)}%`);
    console.log(`│`);
    console.log(
      `Long (${exchange_long}):  ${FR_long.toFixed(4)}% (|${Math.abs(FR_long).toFixed(4)}%|)`,
    );
    console.log(
      `Short (${exchange_short}): ${FR_short.toFixed(4)}% (|${Math.abs(FR_short).toFixed(4)}%|)`,
    );
    console.log(`│`);
    console.log(
      `Funding Diff: ${fundingDiff.toFixed(4)}% (|${Math.abs(FR_long).toFixed(4)}%| - |${Math.abs(FR_short).toFixed(4)}%|)`,
    );
    console.log(`Threshold:    ${this.flipExitThresholdPct.toFixed(4)}%`);
    console.log("─".repeat(60));

    // Check if funding diff is below threshold (danger zone)
    if (fundingDiff < this.flipExitThresholdPct) {
      console.log(`❌ FLIP DETECTED: Funding margin too thin!`);
      console.log(`   → Triggering EMERGENCY EXIT`);
      console.log("─".repeat(60));

      // 🔒 SET FLAG TO PREVENT MULTIPLE TRIGGERS
      this.exitInProgress = true;
      console.log("🔒 Exit lock acquired - preventing duplicate triggers");

      this.emergencyExit("FLIP_EXIT", {
        reason: `Funding rate differential dropped to ${fundingDiff.toFixed(4)}% < threshold ${this.flipExitThresholdPct.toFixed(4)}%`,
        currentDiff: fundingDiff,
        deltaFR: FR_delta,
        coindcxFR: FR_coindcx,
        longFR: FR_long,
        shortFR: FR_short,
        exchangeLong: exchange_long,
        exchangeShort: exchange_short,
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition,
      });
    } else {
      console.log(
        `✅ Flip safe: ${fundingDiff.toFixed(4)}% margin remains > ${this.flipExitThresholdPct.toFixed(4)}%`,
      );
      console.log("─".repeat(60));
    }
  }

  /**
   * Check if both positions are still active
   * Trigger emergency exit if one side is missing for too long
   */
  /**
   * Double verification: Check position via both WebSocket AND REST API
   * Returns true only if BOTH sources confirm position exists
   */
  async verifyPositionExists(exchange) {
    console.log(`\n🔍 DOUBLE VERIFICATION for ${exchange}`);
    console.log("─".repeat(60));

    // Check WebSocket data
    const wsHas =
      exchange === "delta"
        ? this.hasDeltaPosition()
        : this.hasCoindcxPosition();
    console.log(`   WebSocket: ${wsHas ? "✅ Active" : "❌ None"}`);

    // Force REST API check
    console.log(`   Fetching from REST API...`);

    let restHas = false;
    try {
      if (exchange === "delta") {
        const positions = await deltaAPI.getAllPositions();
        const activePosition =
          Array.isArray(positions) &&
          positions.find((p) => Math.abs(parseFloat(p.size || 0)) > 0);
        restHas = !!activePosition;

        if (restHas && !wsHas) {
          // Update WebSocket data if REST has it but WS doesn't
          console.log(`   📝 Updating WebSocket from REST`);
          activePosition.side =
            parseFloat(activePosition.size) > 0 ? "LONG" : "SHORT";
          this.latestDeltaPosition = activePosition;
        }
      } else {
        const positions = await coindcxAPI.getPositions();
        const activePosition =
          Array.isArray(positions) &&
          positions.find((p) => {
            const size = Math.abs(
              parseFloat(p.size || p.active_pos || p.positionAmount || 0),
            );
            return size > 0;
          });
        restHas = !!activePosition;

        if (restHas && !wsHas) {
          // Update WebSocket data if REST has it but WS doesn't
          console.log(`   📝 Updating WebSocket from REST`);
          const size = parseFloat(
            activePosition.size ||
              activePosition.active_pos ||
              activePosition.positionAmount ||
              0,
          );
          activePosition.side = size > 0 ? "LONG" : "SHORT";
          this.latestCoindcxPosition = activePosition;
        }
      }
    } catch (error) {
      console.error(`   REST API Error: ${error.message}`);
    }

    console.log(`   REST API: ${restHas ? "✅ Active" : "❌ None"}`);

    // Treat REST as source of truth when WS is missing; if either shows active, consider it active
    const confirmed = wsHas || restHas;

    console.log(
      `   Final Verdict: ${confirmed ? "✅ CONFIRMED ACTIVE" : "❌ NOT ACTIVE (both sources absent)"}`,
    );
    console.log("─".repeat(60));

    return confirmed;
  }

  async checkPositionExistence() {
    console.log("\n🔍 POSITION EXISTENCE CHECK");
    console.log("─".repeat(60));

    const ONE_SIDED_TIMEOUT_MS = 20000; // 20 seconds - faster response as user requested
    const now = Date.now();

    // 🔴 ONLY force REST when:
    // 1. Delta just reconnected (stale WS data risk)
    // 2. One-sided scenario detected and waiting for timeout
    const forceRest =
      this.forceDeltaRestVerification || !!this.oneSidedDetectedAt;
    await this.verifyPositionsViaREST(forceRest);

    // Clear the flag after forcing one REST check
    if (this.forceDeltaRestVerification) {
      this.forceDeltaRestVerification = false;
    }

    const hasDelta = this.hasDeltaPosition();
    const hasCoindcx = this.hasCoindcxPosition();

    console.log(`   Delta:   ${hasDelta ? "✅ Active" : "❌ Missing"}`);
    if (hasDelta) {
      console.log(
        `            Symbol: ${this.latestDeltaPosition.product_symbol}`,
      );
      console.log(
        `            Size: ${this.getDeltaPositionSize(this.latestDeltaPosition)}`,
      );
    }

    console.log(`   CoinDCX: ${hasCoindcx ? "✅ Active" : "❌ Missing"}`);
    if (hasCoindcx) {
      console.log(
        `            Symbol: ${this.latestCoindcxPosition.symbol || this.latestCoindcxPosition.pair}`,
      );
      console.log(
        `            Size: ${this.getCoindcxPositionSize(this.latestCoindcxPosition)}`,
      );
    }

    // Both positions active - reset timer
    if (hasDelta && hasCoindcx) {
      if (this.oneSidedDetectedAt) {
        console.log(`   ✅ Both positions restored`);
        this.oneSidedDetectedAt = null;
      }
      console.log("─".repeat(60));
      return;
    }

    // Both positions missing - nothing to monitor
    if (!hasDelta && !hasCoindcx) {
      if (this.oneSidedDetectedAt) {
        console.log(`   ℹ️ Both positions closed`);
        this.oneSidedDetectedAt = null;
      }
      console.log("─".repeat(60));
      return;
    }

    // One-sided detected
    if (!this.oneSidedDetectedAt) {
      const activeSide = hasDelta ? "Delta" : "CoinDCX";
      const missingSide = hasDelta ? "CoinDCX" : "Delta";

      // 🛡️ CHECK: If the missing side was intentionally exited, don't start timer
      const missingWasIntentional =
        (missingSide === "Delta" && this.deltaExitConfirmed) ||
        (missingSide === "CoinDCX" && this.coindcxExitConfirmed);

      if (missingWasIntentional) {
        console.log(
          `   ℹ️ ONE-SIDED (EXPECTED): ${activeSide} active, ${missingSide} was intentionally exited`,
        );
        console.log(
          `   ⏭️ Skipping one-sided exit trigger - this is expected from recent exit`,
        );
        console.log("─".repeat(60));
        return;
      }

      this.oneSidedDetectedAt = now;
      console.log(
        `   ⚠️ ONE-SIDED: ${activeSide} active, ${missingSide} missing!`,
      );
      console.log(
        `   ⏱️ Starting ${ONE_SIDED_TIMEOUT_MS / 1000}s grace period...`,
      );
      console.log("─".repeat(60));
      return;
    }

    const timeSinceDetection = now - this.oneSidedDetectedAt;
    const remainingMs = ONE_SIDED_TIMEOUT_MS - timeSinceDetection;

    console.log(
      `   ⏱️ One-sided for ${(timeSinceDetection / 1000).toFixed(0)}s`,
    );

    if (timeSinceDetection >= ONE_SIDED_TIMEOUT_MS) {
      console.log("⚠️ ONE-SIDED TIMEOUT REACHED (20 seconds)");
      console.log("─".repeat(60));
      console.log("   Performing DOUBLE VERIFICATION (REST + WebSocket)...");

      // DOUBLE VERIFICATION: Check both exchanges via REST + WebSocket
      const deltaConfirmed = await this.verifyPositionExists("delta");
      const coindcxConfirmed = await this.verifyPositionExists("coindcx");

      console.log("\n📊 DOUBLE VERIFICATION RESULTS:");
      console.log("─".repeat(60));
      console.log(
        `   Delta: ${deltaConfirmed ? "✅ CONFIRMED ACTIVE" : "❌ CONFIRMED CLOSED"}`,
      );
      console.log(
        `   CoinDCX: ${coindcxConfirmed ? "✅ CONFIRMED ACTIVE" : "❌ CONFIRMED CLOSED"}`,
      );
      console.log("─".repeat(60));

      if (deltaConfirmed && coindcxConfirmed) {
        console.log(
          "✅ Both positions CONFIRMED ACTIVE after double verification",
        );
        console.log("   → False alarm, resetting timer");
        this.oneSidedDetectedAt = null;
        console.log("─".repeat(60));
        return;
      }

      if (!deltaConfirmed && !coindcxConfirmed) {
        console.log(
          "✅ Both positions CONFIRMED CLOSED after double verification",
        );
        console.log("   → No exit needed, resetting timer");
        this.oneSidedDetectedAt = null;
        console.log("─".repeat(60));
        return;
      }

      // ONE-SIDED CONFIRMED - Need to exit
      console.log("❌ ONE-SIDED CONFIRMED → EMERGENCY EXIT");
      console.log("─".repeat(60));

      const activeSide = deltaConfirmed ? "Delta" : "CoinDCX";
      const missingSide = deltaConfirmed ? "CoinDCX" : "Delta";

      // 🛡️ DOUBLE CHECK: If missing side was intentionally exited, don't trigger
      const missingWasIntentional =
        (missingSide === "Delta" && this.deltaExitConfirmed) ||
        (missingSide === "CoinDCX" && this.coindcxExitConfirmed);

      if (missingWasIntentional) {
        console.log(
          `   ℹ️ ${missingSide} was intentionally exited - skipping one-sided exit`,
        );
        console.log(
          `   → This is expected behavior, not a true one-sided scenario`,
        );
        this.oneSidedDetectedAt = null;
        console.log("─".repeat(60));
        return;
      }

      console.log(`   Active Side: ${activeSide}`);
      console.log(`   Missing Side: ${missingSide}`);
      console.log(
        `   Time since detection: ${(timeSinceDetection / 1000).toFixed(0)}s`,
      );
      console.log("   → Triggering emergency exit of remaining position");
      console.log("─".repeat(60));

      this.emergencyExit("emergencyExit", {
        reason: "ONE_SIDED_TIMEOUT",
        activeSide,
        missingSide,
        timeoutSeconds: ONE_SIDED_TIMEOUT_MS / 1000,
        timeSinceDetection: timeSinceDetection / 1000,
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition,
        timestamp: new Date().toISOString(),
        doubleVerified: true,
        deltaConfirmed,
        coindcxConfirmed,
      });

      // IMPORTANT: Reset timer but KEEP MONITORING
      // If one-sided persists after exit, timer will restart on next check
      this.oneSidedDetectedAt = null;
      console.log(
        "\n⏰ Timer reset - will continue monitoring for one-sided positions",
      );
      console.log("─".repeat(60));
    } else {
      console.log(`   ⏳ Remaining: ${(remainingMs / 1000).toFixed(0)}s`);
      console.log("─".repeat(60));
    }
  }

  async verifyPositionsViaREST(force = false) {
    const now = Date.now();
    // Adaptive REST cadence: 10s during mismatch/one-sided/reconnect, 60s otherwise
    const MIN_INTERVAL =
      this.forceDeltaRestVerification ||
      this.oneSidedDetectedAt ||
      this.deltaRestMismatchCount > 0 ||
      this.coindcxRestMismatchCount > 0
        ? 10000
        : 60000;

    if (!force && now - this.lastRestVerificationTime < MIN_INTERVAL) {
      return;
    }

    // Record the time we actually performed a REST verification
    this.lastRestVerificationTime = now;

    console.log("\n🔄 REST API VERIFICATION");
    console.log("─".repeat(50));

    let restHasDelta = false;
    let restHasCoindcx = false;
    let activeDeltaREST = null;
    let activeCoindcxREST = null;

    // ═══════════════════════════════════════════════════════════════
    // DELTA REST CHECK - WITH SIDE DETECTION
    // ═══════════════════════════════════════════════════════════════
    try {
      const deltaPositions = await deltaAPI.getAllPositions();

      // 🔴 CRITICAL: Check if API is rate-limited (null = unavailable)
      if (deltaPositions === null) {
        console.log("   Delta REST: ⚠️ API UNAVAILABLE (rate limited)");
        console.log("   → Skipping Delta REST verification this cycle");
        console.log("   → Keeping existing WebSocket position data");
        // Don't update restHasDelta - keep it false but don't count as mismatch
        // Set a flag to skip mismatch detection for Delta
        restHasDelta = "SKIPPED_RATE_LIMIT";
      } else {
        console.log(
          `   Delta REST: Fetched ${Array.isArray(deltaPositions) ? deltaPositions.length : 0} position(s)`,
        );

        if (Array.isArray(deltaPositions) && deltaPositions.length > 0) {
          // 🔴 ADD SIDE to each position
          deltaPositions.forEach((p, i) => {
            const size = parseFloat(p.size || 0);

            // Determine side from size sign
            // Delta: positive size = LONG, negative size = SHORT
            let side = "UNKNOWN";
            if (size > 0) {
              side = "LONG";
            } else if (size < 0) {
              side = "SHORT";
            }

            // Add side field to position object
            p.side = side;

            console.log(
              `      [${i}] ${p.product_symbol}: size=${p.size}, side=${side}`,
            );
          });

          // Find position with non-zero size
          activeDeltaREST = deltaPositions.find((p) => {
            const size = Math.abs(parseFloat(p.size || 0));
            return size > 0;
          });
        }

        restHasDelta = !!activeDeltaREST;

        if (activeDeltaREST) {
          console.log(`   Delta REST: ✅ ACTIVE POSITION`);
          console.log(`      Symbol: ${activeDeltaREST.product_symbol}`);
          console.log(`      Size: ${activeDeltaREST.size}`);
          console.log(`      Side: ${activeDeltaREST.side}`);
          console.log("      Live Fields:");
          console.log(
            `        entry_price=${activeDeltaREST.entry_price} | mark_price=${activeDeltaREST.mark_price} | liquidation_price=${activeDeltaREST.liquidation_price}`,
          );
          console.log(
            `        margin_mode=${activeDeltaREST.margin_mode} | leverage=${activeDeltaREST.leverage || activeDeltaREST.product?.default_leverage} | maintenance_margin=${activeDeltaREST.product?.maintenance_margin}`,
          );
        } else {
          console.log(`   Delta REST: ❌ NO ACTIVE POSITION`);
        }
      }
    } catch (error) {
      console.error(`   Delta REST: ❌ Error - ${error.message}`);
      // If error contains rate limit, skip mismatch detection
      if (error.message && error.message.includes("429")) {
        restHasDelta = "SKIPPED_RATE_LIMIT";
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // COINDCX REST CHECK - WITH SIDE DETECTION
    // ═══════════════════════════════════════════════════════════════
    try {
      const coindcxPositions = await coindcxAPI.getPositions();

      console.log(
        `   CoinDCX REST: Fetched ${Array.isArray(coindcxPositions) ? coindcxPositions.length : 0} position(s)`,
      );

      if (Array.isArray(coindcxPositions) && coindcxPositions.length > 0) {
        // 🔴 ADD SIDE to each position
        coindcxPositions.forEach((p, i) => {
          const size = parseFloat(
            p.size || p.active_pos || p.positionAmount || 0,
          );

          // Determine side from size sign
          // CoinDCX: positive size = LONG, negative size = SHORT
          let side = "UNKNOWN";
          if (size > 0) {
            side = "LONG";
          } else if (size < 0) {
            side = "SHORT";
          }

          // Add side field to position object
          p.side = side;

          console.log(
            `      [${i}] ${p.symbol || p.pair}: size=${size}, side=${side}`,
          );
        });

        activeCoindcxREST = coindcxPositions.find((p) => {
          const size = Math.abs(
            parseFloat(p.size || p.active_pos || p.positionAmount || 0),
          );
          return size > 0;
        });
      }

      restHasCoindcx = !!activeCoindcxREST;

      if (activeCoindcxREST) {
        console.log(`   CoinDCX REST: ✅ ACTIVE POSITION`);
        console.log(
          `      Symbol: ${activeCoindcxREST.symbol || activeCoindcxREST.pair}`,
        );
        console.log(
          `      Size: ${this.getCoindcxPositionSize(activeCoindcxREST)}`,
        );
        console.log(`      Side: ${activeCoindcxREST.side}`);
      } else {
        console.log(`   CoinDCX REST: ❌ NO ACTIVE POSITION`);
      }
    } catch (error) {
      console.error(`   CoinDCX REST: ❌ Error - ${error.message}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // COMPARE WEBSOCKET VS REST
    // ═══════════════════════════════════════════════════════════════
    const wsHasDelta = this.hasDeltaPosition();
    const wsHasCoindcx = this.hasCoindcxPosition();

    console.log(`\n   📊 COMPARISON:`);
    console.log(`   ┌─────────────┬──────────┬──────────┐`);
    console.log(`   │ Exchange    │ WebSocket│ REST API │`);
    console.log(`   ├─────────────┼──────────┼──────────┤`);
    console.log(
      `   │ Delta       │ ${wsHasDelta ? "✅ YES   " : "❌ NO    "} │ ${restHasDelta ? "✅ YES   " : "❌ NO    "} │`,
    );
    console.log(
      `   │ CoinDCX     │ ${wsHasCoindcx ? "✅ YES   " : "❌ NO    "} │ ${restHasCoindcx ? "✅ YES   " : "❌ NO    "} │`,
    );
    console.log(`   └─────────────┴──────────┴──────────┘`);

    // MISMATCH DETECTION WITH COUNTERS (to clear stale WS state)
    const REST_MISMATCH_THRESHOLD = 1; // immediate clearing on first REST/WS disagreement

    // 🔴 SKIP MISMATCH DETECTION if Delta API is rate-limited
    if (restHasDelta === "SKIPPED_RATE_LIMIT") {
      console.log("\n⚠️ SKIPPING Delta mismatch check (API rate limited)");
      console.log("   → Keeping existing WebSocket data");
      console.log("   → NOT incrementing mismatch counter");
      // Don't change mismatch count - wait for successful REST call
    } else if (wsHasDelta && !restHasDelta) {
      this.deltaRestMismatchCount += 1;
      console.log("\n⚠️ MISMATCH: WebSocket shows Delta, REST shows NONE");
      console.log(
        `   → REST miss count: ${this.deltaRestMismatchCount}/${REST_MISMATCH_THRESHOLD}`,
      );
      console.log(
        "   → If persists, we'll clear WS state to allow one-sided exit",
      );

      if (this.deltaRestMismatchCount >= REST_MISMATCH_THRESHOLD) {
        console.log(
          "❌ Persistent REST mismatch for Delta → clearing WS position",
        );
        this.clearDeltaPosition("rest_mismatch_persistent");
        this.deltaRestMismatchCount = 0;
      }
    } else {
      this.deltaRestMismatchCount = 0;
    }

    if (wsHasCoindcx && !restHasCoindcx) {
      this.coindcxRestMismatchCount += 1;
      console.log("\n⚠️ MISMATCH: WebSocket shows CoinDCX, REST shows NONE");
      console.log(
        `   → REST miss count: ${this.coindcxRestMismatchCount}/${REST_MISMATCH_THRESHOLD}`,
      );
      console.log(
        "   → If persists, we'll clear WS state to allow one-sided exit",
      );

      if (this.coindcxRestMismatchCount >= REST_MISMATCH_THRESHOLD) {
        console.log(
          "❌ Persistent REST mismatch for CoinDCX → clearing WS position",
        );
        this.clearCoindcxPosition("rest_mismatch_persistent");
        this.coindcxRestMismatchCount = 0;
      }
    } else {
      this.coindcxRestMismatchCount = 0;
    }

    // Update from REST if WebSocket is missing but REST has data
    if (
      !wsHasDelta &&
      restHasDelta &&
      restHasDelta !== "SKIPPED_RATE_LIMIT" &&
      activeDeltaREST
    ) {
      console.log("\n🔄 Updating Delta from REST (with side field)");
      this.latestDeltaPosition = activeDeltaREST;
    }

    if (!wsHasCoindcx && restHasCoindcx && activeCoindcxREST) {
      console.log("\n🔄 Updating CoinDCX from REST (with side field)");
      this.latestCoindcxPosition = activeCoindcxREST;
    }

    console.log("─".repeat(50));
  }

  // 🔴 HELPER METHODS to clear positions
  clearDeltaPosition(reason) {
    console.log(`🧹 Clearing Delta position (reason: ${reason})`);
    this.latestDeltaPosition = null;
    if (this.deltaMonitor) {
      this.deltaMonitor.emit("position", { type: "closed", position: null });
    }
  }

  clearCoindcxPosition(reason) {
    console.log(`🧹 Clearing CoinDCX position (reason: ${reason})`);
    this.latestCoindcxPosition = null;
    if (this.coindcxMonitor) {
      this.coindcxMonitor.emit("position", { type: "closed", position: null });
    }
  }

  /**
   * COMPLETE EXIT LOGIC - Updated checkForNormalExit()
   *
   * Priority Order (CRITICAL - runs in this sequence):
   * 1. Stop Loss (0.30% adverse) - ALWAYS ACTIVE
   * 2. Max Hold Time (4 hours) - ALWAYS ACTIVE
   * 3. Wait for Funding Time
   * 4. Post-Funding Wait (15 min)
   * 5. Spread-Based Exit (0.05%)
   * 6. 50% Profit Capture
   * 7. P&L Based Exits
   * 8. Timeout Exit (60 min post-funding)
   */

  checkForNormalExit() {
    if (!this.latestDeltaPosition || !this.latestCoindcxPosition) return;

    console.log("\n🔍 NORMAL EXIT CHECK");
    // console.log("delta", this.latestDeltaPosition);
    // console.log("coindcx", this.latestCoindcxPosition);

    const now = Date.now();
    const deltaMarkPrice = parseFloat(this.latestDeltaPosition.mark_price || 0);
    const coindcxMarkPrice = parseFloat(
      this.latestCoindcxPosition.mark_price || 0,
    );

    // ═══════════════════════════════════════════════════════════════════
    // 🔧 STEP 0: CALCULATE & STORE ENTRY SPREAD (First time only)
    // ═══════════════════════════════════════════════════════════════════
    if (
      deltaMarkPrice &&
      coindcxMarkPrice &&
      this.activeTrade &&
      !this.activeTrade.entrySpread
    ) {
      const priceDifference = coindcxMarkPrice - deltaMarkPrice;
      const entrySpread = Math.abs(priceDifference / deltaMarkPrice) * 100;

      this.activeTrade.entrySpread = entrySpread;
      console.log(`\n💾 ENTRY SPREAD STORED: ${entrySpread.toFixed(4)}%`);
      console.log(`   Delta Entry Price: $${deltaMarkPrice.toFixed(8)}`);
      console.log(`   CoinDCX Entry Price: $${coindcxMarkPrice.toFixed(8)}\n`);
    }

    if (deltaMarkPrice && coindcxMarkPrice) {
      const deltaSymbol = this.latestDeltaPosition?.product_symbol;
      const priceDifference = coindcxMarkPrice - deltaMarkPrice;
      const currentSpread = Math.abs(priceDifference / deltaMarkPrice) * 100;

      console.log("\n📊 SPREAD MONITORING (Post-Funding)");
      console.log("━".repeat(60));
      console.log(`   Delta Mark Price:   $${deltaMarkPrice.toFixed(8)}`);
      console.log(`   CoinDCX Mark Price: $${coindcxMarkPrice.toFixed(8)}`);
      console.log(
        `   Price Difference:   $${priceDifference.toFixed(8)} (${priceDifference >= 0 ? "+" : ""}${((priceDifference / deltaMarkPrice) * 100).toFixed(4)}%)`,
      );
      console.log(`   Current Spread:     ${currentSpread.toFixed(4)}%`);

      const EXIT_SPREAD_TARGET = 0.03; // 0.02%

      if (false) {
        // DISABLED: Spread convergence exit
        console.log(`\n✅ SPREAD CONVERGENCE DETECTED (After Funding)!`);
        console.log(`   Target: ≤ ${EXIT_SPREAD_TARGET}%`);
        console.log(`   Actual: ${currentSpread.toFixed(4)}%`);
        // console.log(`   Time since funding: ${(timeSinceLockedFunding / 1000).toFixed(0)}s`);
        console.log(`   → Triggering EXIT`);
        console.log("━".repeat(60));

        const coindcxSymbol =
          this.latestCoindcxPosition.symbol ||
          this.latestCoindcxPosition.contractPair;

        // Safety check: ensure symbols exist before getting funding rates
        if (!coindcxSymbol) {
          console.warn(
            "⚠️ coindcxSymbol is undefined, skipping funding rate lookup",
          );
          return;
        }

        const deltaFRData = deltaSymbol
          ? this.deltaMonitor.getFundingRate(deltaSymbol)
          : null;
        const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);

        this.emergencyExit("SPREAD_CONVERGENCE", {
          reason: `Spread converged to ${currentSpread.toFixed(4)}% after funding (target: ${EXIT_SPREAD_TARGET}%)`,
          currentSpread: currentSpread,
          targetSpread: EXIT_SPREAD_TARGET,
          deltaMarkPrice: deltaMarkPrice,
          coindcxMarkPrice: coindcxMarkPrice,
          priceDifference: priceDifference,
          // timeSinceFunding: (timeSinceLockedFunding / 1000).toFixed(0),
          deltaFR: deltaFRData ? deltaFRData.rate : null,
          coindcxFR: coindcxFRData ? coindcxFRData.rate : null,
          deltaPosition: this.latestDeltaPosition,
          coindcxPosition: this.latestCoindcxPosition,
        });

        this.resetFundingState();
        return;
      }

      console.log(
        `   Status: Spread ${currentSpread.toFixed(4)}% > ${EXIT_SPREAD_TARGET}% → Continue monitoring`,
      );
      console.log("━".repeat(60));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🛑 PRIORITY 1: STOP LOSS (ALWAYS ACTIVE - Most Critical)
    // Exit if spread moved adverse by 0.30% from entry
    // NOTE: This runs BEFORE and AFTER funding time - it's a safety net
    // ═══════════════════════════════════════════════════════════════════
    if (
      deltaMarkPrice &&
      coindcxMarkPrice &&
      this.activeTrade &&
      this.activeTrade.entrySpread
    ) {
      const currentSpread =
        Math.abs((coindcxMarkPrice - deltaMarkPrice) / deltaMarkPrice) * 100;
      const spreadChange = currentSpread - this.activeTrade.entrySpread;

      const STOP_LOSS_THRESHOLD = 5.0; // 0.30% adverse movement

      if (spreadChange > STOP_LOSS_THRESHOLD) {
        console.log("\n🛑🛑🛑 STOP LOSS TRIGGERED 🛑🛑🛑");
        console.log("=".repeat(60));
        console.log(`   ⚠️  SAFETY EXIT - Active at ALL times`);
        console.log(
          `   Entry Spread: ${this.activeTrade.entrySpread.toFixed(4)}%`,
        );
        console.log(`   Current Spread: ${currentSpread.toFixed(4)}%`);
        console.log(
          `   Adverse Movement: ${spreadChange.toFixed(4)}% (> ${STOP_LOSS_THRESHOLD}% threshold)`,
        );
        console.log(`   → IMMEDIATE EXIT TO PREVENT FURTHER LOSS`);
        console.log("=".repeat(60));

        const deltaSymbol = this.latestDeltaPosition.product_symbol;
        const coindcxSymbol =
          this.latestCoindcxPosition.symbol ||
          this.latestCoindcxPosition.contractPair;
        const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
        const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);

        this.emergencyExit("STOP_LOSS", {
          reason: `Stop loss: Spread widened by ${spreadChange.toFixed(4)}% (threshold: ${STOP_LOSS_THRESHOLD}%)`,
          entrySpread: this.activeTrade.entrySpread,
          currentSpread: currentSpread,
          spreadChange: spreadChange,
          deltaMarkPrice: deltaMarkPrice,
          coindcxMarkPrice: coindcxMarkPrice,
          deltaFR: deltaFRData ? deltaFRData.rate : null,
          coindcxFR: coindcxFRData ? coindcxFRData.rate : null,
          deltaPosition: this.latestDeltaPosition,
          coindcxPosition: this.latestCoindcxPosition,
        });

        this.resetFundingState();
        return;
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ⏰ PRIORITY 2: MAXIMUM HOLD TIME (ALWAYS ACTIVE - 4 hours)
    // NOTE: This runs BEFORE and AFTER funding time - it's a safety net
    // ═══════════════════════════════════════════════════════════════════
    // if (this.activeTrade && this.activeTrade.entryTime) {
    //   const timeInTrade = now - this.activeTrade.entryTime;
    //   const MAX_HOLD_TIME = 4 * 60 * 60 * 1000; // 4 hours

    //   if (timeInTrade > MAX_HOLD_TIME) {
    //     console.log('\n⏰⏰⏰ MAXIMUM HOLD TIME EXCEEDED ⏰⏰⏰');
    //     console.log('='.repeat(60));
    //     console.log(`   ⚠️  SAFETY EXIT - Active at ALL times`);
    //     console.log(`   Entry Time: ${new Date(this.activeTrade.entryTime).toLocaleString('en-IN')}`);
    //     console.log(`   Current Time: ${new Date(now).toLocaleString('en-IN')}`);
    //     console.log(`   Time in Trade: ${(timeInTrade / 3600000).toFixed(2)} hours`);
    //     console.log(`   Max Allowed: 4 hours`);
    //     console.log(`   → FORCING EXIT`);
    //     console.log('='.repeat(60));

    //     const deltaSymbol = this.latestDeltaPosition.product_symbol;
    //     const coindcxSymbol = this.latestCoindcxPosition.symbol || this.latestCoindcxPosition.contractPair;
    //     const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
    //     const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);

    //     this.emergencyExit("MAX_HOLD_TIME", {
    //       reason: `Maximum hold time (4 hours) exceeded`,
    //       timeInTrade: (timeInTrade / 3600000).toFixed(2),
    //       entryTime: this.activeTrade.entryTime,
    //       deltaFR: deltaFRData ? deltaFRData.rate : null,
    //       coindcxFR: coindcxFRData ? coindcxFRData.rate : null,
    //       deltaPosition: this.latestDeltaPosition,
    //       coindcxPosition: this.latestCoindcxPosition,
    //     });

    //     this.resetFundingState();
    //     return;
    //   }
    // }

    // ═══════════════════════════════════════════════════════════════════
    // 📅 STEP 3: GET FUNDING TIME INFO & WAIT FOR FUNDING
    // ═══════════════════════════════════════════════════════════════════
    const deltaSymbol = this.latestDeltaPosition.product_symbol;
    const frData = this.deltaMonitor.getFundingRate(deltaSymbol);

    if (!frData || !frData.nextFundingTime) {
      console.log("⏳ Waiting for Delta funding rate data...");
      return;
    }

    const fundingTimeMs =
      frData.nextFundingTime instanceof Date
        ? frData.nextFundingTime.getTime()
        : new Date(frData.nextFundingTime).getTime();

    if (Number.isNaN(fundingTimeMs)) {
      console.error("❌ Invalid funding time format:", frData.nextFundingTime);
      return;
    }

    const timeUntilFunding = fundingTimeMs - now;

    console.log(`\n📅 Funding Schedule:`);
    console.log(`   Current Time: ${new Date(now).toLocaleString("en-IN")}`);
    console.log(
      `   Next Funding: ${new Date(fundingTimeMs).toLocaleString("en-IN")}`,
    );
    console.log(
      `   Time Until Funding: ${(timeUntilFunding / 1000).toFixed(0)}s (${(timeUntilFunding / 60000).toFixed(1)} minutes)`,
    );

    // Wait until funding time passes
    if (timeUntilFunding > 0) {
      const minutes = Math.floor(timeUntilFunding / 60000);
      const seconds = Math.floor((timeUntilFunding % 60000) / 1000);
      console.log(
        `⏳ Waiting for funding... ${minutes}m ${seconds}s remaining`,
      );
      console.log(`   → Spread exit is DISABLED until funding completes`);
      console.log(
        `   → Only Stop Loss (${0.3}%) and Max Hold Time (4h) are active\n`,
      );

      this.lockedFundingTime = null;
      this.fundingConfirmedAt = null;
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🕒 STEP 4: FUNDING TIME PASSED - LOCK IT ONCE
    // ═══════════════════════════════════════════════════════════════════
    if (!this.lockedFundingTime) {
      this.lockedFundingTime = fundingTimeMs;
      this.lastRealizedFunding = Number(
        this.latestDeltaPosition.realized_funding || 0,
      );

      console.log("\n🕒 FUNDING TIME REACHED!");
      console.log(
        `   Locked At: ${new Date(this.lockedFundingTime).toLocaleString("en-IN")}`,
      );
      console.log(
        `   Initial Realized Funding: $${this.lastRealizedFunding.toFixed(4)}`,
      );
      console.log(`   → Starting exit window monitoring\n`);
    }

    const timeSinceLockedFunding = now - this.lockedFundingTime;
    console.log(
      `\n⏱️  Time since funding: ${(timeSinceLockedFunding / 1000).toFixed(0)}s (${(timeSinceLockedFunding / 60000).toFixed(1)} minutes)`,
    );

    // ═══════════════════════════════════════════════════════════════════
    // ⏳ STEP 5: FUNDING SETTLEMENT + POST-FUNDING WAIT (15-30 min)
    // ═══════════════════════════════════════════════════════════════════
    const FUNDING_SETTLEMENT_BUFFER = 30000; // 30 seconds
    const POST_FUNDING_WAIT = 15 * 60 * 1000; // 15 minutes
    const TOTAL_WAIT_TIME = FUNDING_SETTLEMENT_BUFFER + POST_FUNDING_WAIT;

    // Detect funding settlement
    const currentRealizedFunding = Number(
      this.latestDeltaPosition.realized_funding || 0,
    );
    if (
      currentRealizedFunding !== this.lastRealizedFunding &&
      !this.fundingConfirmedAt
    ) {
      this.fundingConfirmedAt = now;
      const fundingReceived = currentRealizedFunding - this.lastRealizedFunding;
      console.log(`\n💰 FUNDING SETTLEMENT DETECTED!`);
      console.log(`   Amount Received: $${fundingReceived.toFixed(4)}`);
      console.log(
        `   Confirmed At: ${new Date(this.fundingConfirmedAt).toLocaleString("en-IN")}`,
      );

      if (this.activeTrade) {
        this.activeTrade.fundingReceived = true;
        this.activeTrade.fundingTime = this.fundingConfirmedAt;
      }
    }

    if (timeSinceLockedFunding < TOTAL_WAIT_TIME) {
      const waitRemaining = TOTAL_WAIT_TIME - timeSinceLockedFunding;

      if (timeSinceLockedFunding < FUNDING_SETTLEMENT_BUFFER) {
        console.log(
          `\n⏳ Waiting for funding settlement (${FUNDING_SETTLEMENT_BUFFER / 1000}s)...`,
        );
        console.log(
          `   Last Realized Funding: $${this.lastRealizedFunding.toFixed(4)}`,
        );
        console.log(
          `   Current Realized Funding: $${currentRealizedFunding.toFixed(4)}`,
        );
        console.log(
          `   Buffer remaining: ${(waitRemaining / 1000).toFixed(0)}s\n`,
        );
      } else {
        console.log(
          `\n⏳ POST-FUNDING WAIT PERIOD (${POST_FUNDING_WAIT / 60000} minutes)`,
        );
        console.log(`   Purpose: Allow spread to stabilize after funding`);
        console.log(
          `   Time since funding: ${(timeSinceLockedFunding / 60000).toFixed(1)} minutes`,
        );
        console.log(
          `   Wait remaining: ${(waitRemaining / 60000).toFixed(1)} minutes`,
        );
        console.log(`   → Stop Loss (${0.3}%) and Max Hold Time still active`);
        console.log(`   → Exit checks will activate after wait period\n`);
      }

      return;
    }

    console.log(`\n✅ POST-FUNDING WAIT COMPLETE`);
    console.log(
      `   Total time since funding: ${(timeSinceLockedFunding / 60000).toFixed(1)} minutes`,
    );
    console.log(`   → Now checking exit conditions...\n`);

    // ═══════════════════════════════════════════════════════════════════
    // 🎯 PRIORITY 3: SPREAD-BASED EXIT (Post-Funding Only)
    // Exit Rule: Spread ≤ 0.05%
    // ═══════════════════════════════════════════════════════════════════
    if (deltaMarkPrice && coindcxMarkPrice) {
      const priceDifference = coindcxMarkPrice - deltaMarkPrice;
      const currentSpread = Math.abs(priceDifference / deltaMarkPrice) * 100;

      console.log("\n📊 SPREAD MONITORING (Post-Funding)");
      console.log("━".repeat(60));
      console.log(`   Delta Mark Price:   $${deltaMarkPrice.toFixed(8)}`);
      console.log(`   CoinDCX Mark Price: $${coindcxMarkPrice.toFixed(8)}`);
      console.log(
        `   Price Difference:   $${priceDifference.toFixed(8)} (${priceDifference >= 0 ? "+" : ""}${((priceDifference / deltaMarkPrice) * 100).toFixed(4)}%)`,
      );
      console.log(`   Current Spread:     ${currentSpread.toFixed(4)}%`);

      const EXIT_SPREAD_TARGET = 0.03; // 0.05%

      if (currentSpread <= EXIT_SPREAD_TARGET) {
        console.log(`\n✅ SPREAD CONVERGENCE DETECTED (After Funding)!`);
        console.log(`   Target: ≤ ${EXIT_SPREAD_TARGET}%`);
        console.log(`   Actual: ${currentSpread.toFixed(4)}%`);
        console.log(
          `   Time since funding: ${(timeSinceLockedFunding / 1000).toFixed(0)}s`,
        );
        console.log(`   → Triggering EXIT`);
        console.log("━".repeat(60));

        const coindcxSymbol =
          this.latestCoindcxPosition.symbol ||
          this.latestCoindcxPosition.contractPair;
        const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
        const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);

        this.emergencyExit("SPREAD_CONVERGENCE", {
          reason: `Spread converged to ${currentSpread.toFixed(4)}% after funding (target: ${EXIT_SPREAD_TARGET}%)`,
          currentSpread: currentSpread,
          targetSpread: EXIT_SPREAD_TARGET,
          deltaMarkPrice: deltaMarkPrice,
          coindcxMarkPrice: coindcxMarkPrice,
          priceDifference: priceDifference,
          timeSinceFunding: (timeSinceLockedFunding / 1000).toFixed(0),
          deltaFR: deltaFRData ? deltaFRData.rate : null,
          coindcxFR: coindcxFRData ? coindcxFRData.rate : null,
          deltaPosition: this.latestDeltaPosition,
          coindcxPosition: this.latestCoindcxPosition,
        });

        this.resetFundingState();
        return;
      }

      console.log(
        `   Status: Spread ${currentSpread.toFixed(4)}% > ${EXIT_SPREAD_TARGET}% → Continue monitoring`,
      );
      console.log("━".repeat(60));
    }

    // ═══════════════════════════════════════════════════════════════════
    // ✅ PRIORITY 4: 50% PROFIT CAPTURE (Post-Funding)
    // Exit if spread has captured 50% of entry spread
    // ═══════════════════════════════════════════════════════════════════
    if (
      deltaMarkPrice &&
      coindcxMarkPrice &&
      this.activeTrade &&
      this.activeTrade.entrySpread
    ) {
      const priceDifference = coindcxMarkPrice - deltaMarkPrice;
      const currentSpread = Math.abs(priceDifference / deltaMarkPrice) * 100;
      const spreadCaptured = this.activeTrade.entrySpread - currentSpread;
      const percentCaptured =
        (spreadCaptured / this.activeTrade.entrySpread) * 100;

      const PROFIT_50_THRESHOLD = 50; // 50% captured

      if (percentCaptured >= PROFIT_50_THRESHOLD) {
        console.log("\n✅✅✅ 50% PROFIT CAPTURED ✅✅✅");
        console.log("=".repeat(60));
        console.log(
          `   Entry Spread: ${this.activeTrade.entrySpread.toFixed(4)}%`,
        );
        console.log(`   Current Spread: ${currentSpread.toFixed(4)}%`);
        console.log(`   Spread Captured: ${spreadCaptured.toFixed(4)}%`);
        console.log(
          `   Percent Captured: ${percentCaptured.toFixed(2)}% (target: ${PROFIT_50_THRESHOLD}%)`,
        );
        console.log(`   → EXECUTING PROFIT-TAKING EXIT`);
        console.log("=".repeat(60));

        const coindcxSymbol =
          this.latestCoindcxPosition.symbol ||
          this.latestCoindcxPosition.contractPair;
        const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
        const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);

        this.emergencyExit("PROFIT_50_PERCENT", {
          reason: `50% profit captured: ${percentCaptured.toFixed(2)}% of entry spread`,
          entrySpread: this.activeTrade.entrySpread,
          currentSpread: currentSpread,
          spreadCaptured: spreadCaptured,
          percentCaptured: percentCaptured,
          deltaMarkPrice: deltaMarkPrice,
          coindcxMarkPrice: coindcxMarkPrice,
          timeSinceFunding: (timeSinceLockedFunding / 1000).toFixed(0),
          deltaFR: deltaFRData ? deltaFRData.rate : null,
          coindcxFR: coindcxFRData ? coindcxFRData.rate : null,
          deltaPosition: this.latestDeltaPosition,
          coindcxPosition: this.latestCoindcxPosition,
        });

        this.resetFundingState();
        return;
      }

      console.log(`\n📊 Profit Capture Progress:`);
      console.log(
        `   Entry Spread: ${this.activeTrade.entrySpread.toFixed(4)}%`,
      );
      console.log(`   Current Spread: ${currentSpread.toFixed(4)}%`);
      console.log(
        `   Captured: ${spreadCaptured.toFixed(4)}% (${percentCaptured.toFixed(2)}%)`,
      );
      console.log(`   Target: ${PROFIT_50_THRESHOLD}% of entry spread\n`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 💰 PRIORITY 5: P&L BASED EXITS
    // ═══════════════════════════════════════════════════════════════════
    const MAX_WAIT_AFTER_FUNDING_MS = 60 * 60 * 1000; // 60 minutes

    const deltaPnL = this.latestDeltaPosition.unrealized_pnl || 0;
    const coindcxPnL = this.calculateCoindcxUnrealizedPnL(
      this.latestCoindcxPosition,
    );
    const totalPnL = deltaPnL + coindcxPnL;

    console.log("\n💰 P&L Status (Post-Funding):");
    console.log(`   Delta unrealized P&L: $${deltaPnL.toFixed(4)}`);
    console.log(`   CoinDCX unrealized P&L: $${coindcxPnL.toFixed(4)}`);
    console.log(`   Combined P&L: $${totalPnL.toFixed(4)}`);

    // Check if total PnL is positive
    if (totalPnL >= 0) {
      console.log("\n✅ PROFIT TARGET REACHED → EXECUTING EXIT");
      console.log(`   Combined P&L: $${totalPnL.toFixed(4)} >= $0`);
      console.log(`   → Exiting after funding completion`);

      const coindcxSymbol =
        this.latestCoindcxPosition.symbol ||
        this.latestCoindcxPosition.contractPair;
      const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
      const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);

      this.emergencyExit("PROFIT_EXIT", {
        reason: "Profit target reached after funding",
        totalPnL: totalPnL,
        deltaPnL: deltaPnL,
        coindcxPnL: coindcxPnL,
        fundingTime: this.lockedFundingTime,
        fundingConfirmedAt: this.fundingConfirmedAt,
        timeSinceLockedFunding: (timeSinceLockedFunding / 1000).toFixed(0),
        deltaFR: deltaFRData ? deltaFRData.rate : null,
        coindcxFR: coindcxFRData ? coindcxFRData.rate : null,
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition,
      });

      this.resetFundingState();
      return;
    }

    // Check if both positions are positive
    if (deltaPnL >= 0 && coindcxPnL >= 0) {
      console.log("\n✅ BOTH POSITIONS PROFITABLE → EXECUTING EXIT");
      console.log(`   Delta P&L: $${deltaPnL.toFixed(4)} >= $0`);
      console.log(`   CoinDCX P&L: $${coindcxPnL.toFixed(4)} >= $0`);
      console.log(`   Combined P&L: $${totalPnL.toFixed(4)}`);

      const coindcxSymbol =
        this.latestCoindcxPosition.symbol ||
        this.latestCoindcxPosition.contractPair;
      const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
      const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);

      this.emergencyExit("PROFIT_EXIT", {
        reason: "Both positions profitable after funding",
        totalPnL: totalPnL,
        deltaPnL: deltaPnL,
        coindcxPnL: coindcxPnL,
        fundingTime: this.lockedFundingTime,
        fundingConfirmedAt: this.fundingConfirmedAt,
        timeSinceLockedFunding: (timeSinceLockedFunding / 1000).toFixed(0),
        deltaFR: deltaFRData ? deltaFRData.rate : null,
        coindcxFR: coindcxFRData ? coindcxFRData.rate : null,
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition,
      });

      this.resetFundingState();
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // ⏱️ PRIORITY 6: TIMEOUT EXIT (60 min post-funding)
    // ═══════════════════════════════════════════════════════════════════
    // if (timeSinceLockedFunding >= MAX_WAIT_AFTER_FUNDING_MS) {
    //   console.log("\n⚠️ EMERGENCY TIMEOUT → FORCING EXIT");
    //   console.log(`   Funding time: ${new Date(this.lockedFundingTime).toLocaleString("en-IN")}`);
    //   console.log(`   Time elapsed: ${(timeSinceLockedFunding / 60000).toFixed(1)} minutes`);
    //   console.log(`   Current P&L: $${totalPnL.toFixed(4)}`);
    //   console.log(`   → Maximum wait time (${MAX_WAIT_AFTER_FUNDING_MS/60000} minutes) exceeded`);

    //   const coindcxSymbol = this.latestCoindcxPosition.symbol || this.latestCoindcxPosition.contractPair;
    //   const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
    //   const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);

    //   this.emergencyExit("TIMEOUT_EXIT", {
    //     reason: `Emergency timeout: ${(MAX_WAIT_AFTER_FUNDING_MS/60000)} minutes after funding without profit target`,
    //     totalPnL: totalPnL,
    //     deltaPnL: deltaPnL,
    //     coindcxPnL: coindcxPnL,
    //     fundingTime: this.lockedFundingTime,
    //     fundingConfirmedAt: this.fundingConfirmedAt,
    //     timeSinceLockedFunding: (timeSinceLockedFunding / 60000).toFixed(1),
    //     deltaFR: deltaFRData ? deltaFRData.rate : null,
    //     coindcxFR: coindcxFRData ? coindcxFRData.rate : null,
    //     deltaPosition: this.latestDeltaPosition,
    //     coindcxPosition: this.latestCoindcxPosition,
    //   });

    //   this.resetFundingState();
    //   return;
    // }

    // ═══════════════════════════════════════════════════════════════════
    // ⏳ STILL MONITORING
    // ═══════════════════════════════════════════════════════════════════
    const elapsedMinutes = (timeSinceLockedFunding / 60000).toFixed(1);
    const remainingMinutes = (
      (MAX_WAIT_AFTER_FUNDING_MS - timeSinceLockedFunding) /
      60000
    ).toFixed(1);

    console.log(`\n⏳ Monitoring for profit target...`);
    console.log(
      `   Elapsed: ${elapsedMinutes} minutes | Remaining: ${remainingMinutes} minutes`,
    );
    console.log(`   Current P&L: $${totalPnL.toFixed(4)}`);
    console.log(`   Target: Total PnL >= $0 OR Both positions >= $0`);
    console.log(
      `   → Will continue monitoring until profit target or timeout\n`,
    );
  }

  // Helper method to reset funding state
  resetFundingState() {
    this.lockedFundingTime = null;
    this.lastRealizedFunding = null;
    this.fundingConfirmedAt = null;
    this.oneSidedDetectedAt = null;
  }

  calculateCoindcxUnrealizedPnL(position) {
    // CoinDCX provides unrealized PnL directly in their position data
    // Use their calculation instead of manual calculation (which requires mark_price that WebSocket doesn't provide)
    const unrealizedPnl = parseFloat(
      position.unrealised_pnl || position.unrealisedPnl || position.pnl || 0,
    );

    console.log(
      `📊 CoinDCX PnL: $${unrealizedPnl.toFixed(4)} (from ${position.symbol || position.pair})`,
    );

    return unrealizedPnl;
  }

  calculateFundingDifference(FR_first, FR_second) {
    // Formula: fundingDiff = |FR_first| - |FR_second|
    // FR_first should be LONG (higher absolute funding rate)
    // FR_second should be SHORT (lower absolute funding rate)
    return Math.abs(FR_first) - Math.abs(FR_second);
  }

  async emergencyExit(reason, details) {
    console.log("\n🚨🚨🚨 EMERGENCY EXIT TRIGGERED 🚨🚨🚨");
    console.log(`Reason: ${reason}`);
    console.log("=".repeat(60));

    // DOUBLE VERIFICATION before exit (unless already verified for one-sided)
    if (!details.doubleVerified) {
      console.log("\n🔍 DOUBLE VERIFICATION BEFORE EXIT");
      console.log("━".repeat(60));
      console.log("   Verifying both positions via REST + WebSocket...");

      const deltaConfirmed = await this.verifyPositionExists("delta");
      const coindcxConfirmed = await this.verifyPositionExists("coindcx");

      console.log("\n📊 VERIFICATION RESULTS:");
      console.log(
        `   Delta: ${deltaConfirmed ? "✅ Active" : "❌ Closed/Missing"}`,
      );
      console.log(
        `   CoinDCX: ${coindcxConfirmed ? "✅ Active" : "❌ Closed/Missing"}`,
      );

      // Store verification results in details
      details.deltaConfirmed = deltaConfirmed;
      details.coindcxConfirmed = coindcxConfirmed;
      details.doubleVerified = true;

      // If both positions are already closed, no need to exit
      if (!deltaConfirmed && !coindcxConfirmed) {
        console.log("\n✅ BOTH POSITIONS ALREADY CLOSED");
        console.log("   → No exit needed, canceling emergency exit");
        console.log("=".repeat(60));
        this.resetFundingState();
        this.confirmExitComplete();
        return;
      }

      console.log("━".repeat(60));
    } else {
      console.log("\n✅ Already double verified (from one-sided detection)");
    }

    // Reset one-sided timer to prevent false positives during exit
    this.oneSidedDetectedAt = null;

    this.emit("emergencyExit", {
      reason,
      details,
      activeTrade: this.activeTrade,
      timestamp: new Date().toISOString(),
    });

    // Don't immediately unregister - let the exit handler do it after confirming closure
    // this.unregisterTrade(); // Moved to after exit confirmation

    console.log(
      "\n⏳ Waiting for exit confirmation before stopping monitor...",
    );
    console.log("=".repeat(60));
  }

  async normalExit(details) {
    console.log("\n🔔 NORMAL EXIT INITIATED");
    console.log("=".repeat(60));
    console.log("Reason: Funding period completed (scheduled exit)");

    this.emit("normalExit", {
      ...details,
      activeTrade: this.activeTrade,
      timestamp: new Date().toISOString(),
    });

    this.unregisterTrade();
  }

  registerTrade(trade) {
    console.log("\n📝 TRADE REGISTERED FOR MONITORING");
    console.log("=".repeat(60));
    console.log(
      `Delta: ${trade.deltaSymbol} | Coindcx: ${trade.coindcxSymbol}`,
    );
    console.log("=".repeat(60));

    // Store entry metrics for exit logic
    this.activeTrade = {
      ...trade,
      entryTime: trade.entryTime || Date.now(),
      entrySpread: trade.entrySpread || null, // Will be set from position data
      fundingReceived: false,
      fundingTime: null,
      registeredAt: Date.now(),
    };

    console.log(
      `   Entry Time: ${new Date(this.activeTrade.entryTime).toLocaleString("en-IN")}`,
    );
    if (this.activeTrade.entrySpread) {
      console.log(
        `   Entry Spread: ${this.activeTrade.entrySpread.toFixed(4)}%`,
      );
    }
    console.log("=".repeat(60));

    this.emit("tradeRegistered", this.activeTrade);
  }

  unregisterTrade() {
    console.log("🛑 Monitoring stopped - trade closed");
    this.activeTrade = null;
    this.latestDeltaPosition = null;
    this.latestCoindcxPosition = null;
    this.oneSidedDetectedAt = null;
    this.exitInProgress = false; // 🔓 Reset exit lock
    this.deltaExitConfirmed = false; // 🔓 Reset exit confirmation flags
    this.coindcxExitConfirmed = false;
    this.resetFundingState();
  }

  /**
   * Call this after exit is confirmed to clean up monitoring
   * This should be called by the exit handler after positions are verified closed
   */
  confirmExitComplete(deltaExited = false, coindcxExited = false) {
    console.log("\n✅ EXIT CONFIRMED - Cleaning up monitor state");

    // 🆕 Mark which exchanges successfully exited
    if (deltaExited) {
      this.deltaExitConfirmed = true;
      console.log("   📝 Delta exit confirmed - will not re-trigger");
    }
    if (coindcxExited) {
      this.coindcxExitConfirmed = true;
      console.log("   📝 CoinDCX exit confirmed - will not re-trigger");
    }

    this.exitInProgress = false; // 🔓 Release exit lock
    console.log("🔓 Exit lock released - ready for new operations");

    // Only fully unregister if BOTH sides exited
    if (deltaExited && coindcxExited) {
      console.log("✅ Both sides exited - fully unregistering trade");
      this.unregisterTrade();
    } else {
      console.log(
        "⚠️ Partial exit - keeping monitor active for remaining position",
      );
    }
  }

  async start() {
    console.log("\n🚀 Starting Enhanced Trade Monitor");
    console.log("=".repeat(60));

    this.deltaMonitor.connect();
    await this.coindcxMonitor.connect();

    // Start periodic position existence check (every 15 seconds to reduce API calls)
    this.positionCheckInterval = setInterval(async () => {
      await this.checkPositionExistence();
    }, 15000); // Check every 15 seconds (was 5s - too frequent)

    console.log(
      "✅ Monitor active: Quantity + Flip + Normal Exit + One-Sided protection enabled",
    );
    console.log("=".repeat(60));
  }

  stop() {
    console.log("\n🛑 Stopping Trade Monitor...");

    // Clear periodic position check
    if (this.positionCheckInterval) {
      clearInterval(this.positionCheckInterval);
      this.positionCheckInterval = null;
    }

    this.deltaMonitor.disconnect();
    this.coindcxMonitor.disconnect();
    this.unregisterTrade();
    console.log("✅ Monitor stopped");
  }
}

export default TradeMonitor;

//s
