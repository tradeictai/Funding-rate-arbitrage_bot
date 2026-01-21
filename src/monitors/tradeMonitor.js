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

    this.quantityTolerance = config.trading.quantityTolerance || 0.05; // 5%
    this.minProfitThreshold = config.trading.minProfitThreshold || 0.001; // e.g. 0.01%

    this.liquidationWarningThreshold = 0.03; // 3% from liquidation

    this.bufferPercentForLiquidationProtection =
      config.trading.bufferPercentForLiquidationProtection || 30; // 30%

    this.flipCheckTimer = null;

    this.leverage = config.trading.leverage;

    this.positionCheckInterval = null;
    this.positionVerifyInterval = null;
    this.fundingConfirmedAt = null;
    this.oneSidedDetectedAt = null;

    this.lastRestVerificationTime = 0;

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

    // Pi42 Events
    this.coindcxMonitor.on("position", (data) => {
      console.log("Coindcx position event received:", data);
      this.handleCoindcxPosition(data);
    });

    // Listen to funding rate updates for real-time flip detection
    this.deltaMonitor.on("funding_rate", () => {
      if (this.latestDeltaPosition && this.latestCoindcxPosition) {
        this.checkForNormalExit();
        this.performFlipCheck();
        this.checkPreLiquidation();
        this.checkPositionExistence();
      }
    });

    this.coindcxMonitor.on("funding_rate", () => {
      if (this.latestDeltaPosition && this.latestCoindcxPosition) {
        this.checkForNormalExit();
        this.performFlipCheck();
        this.checkPreLiquidation();
        this.checkPositionExistence();
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

    // Position existence is now checked periodically by interval timer
    this.checkPositionExistence();
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

    // Position existence is now checked periodically by interval timer
    this.checkPositionExistence();
  }

  /**
   * Run all monitoring checks
   */
  async runAllChecks() {
    await this.performQuantityCheck();
    this.checkPreLiquidation();
    this.performFlipCheck();
    this.checkForNormalExit();
    this.checkPositionExistence();
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔴 POSITION CLOSED HANDLERS
  // ═══════════════════════════════════════════════════════════════

  handleDeltaPositionClosed(data) {
    console.log("\n🔴 DELTA POSITION CLOSED DETECTED");
    console.log("=".repeat(60));
    console.log(`   Reason: ${data.reason || data.type || "unknown"}`);

    const previousPosition = this.latestDeltaPosition;
    this.latestDeltaPosition = null;

    // Check if CoinDCX still has position (one-sided scenario)
    if (this.hasCoindcxPosition()) {
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
      });
    }
    console.log("=".repeat(60));
  }

  handleCoindcxPositionClosed(data) {
    console.log("\n🔴 COINDCX POSITION CLOSED DETECTED");
    console.log("=".repeat(60));
    console.log(`   Reason: ${data.reason || data.type || "unknown"}`);

    const previousPosition = this.latestCoindcxPosition;
    this.latestCoindcxPosition = null;

    // Check if Delta still has position (one-sided scenario)
    if (this.hasDeltaPosition()) {
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
      });
    }
    console.log("=".repeat(60));
  }

  // ═══════════════════════════════════════════════════════════════
  // 🛡️ PRE-LIQUIDATION CHECK (3% threshold)
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
  checkPreLiquidation() {
    if (!this.latestDeltaPosition || !this.latestCoindcxPosition) return false;

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

        // Positions
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition,
        timestamp: new Date().toISOString(),
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

  async performQuantityCheck(deltaPosition, coindcxPosition) {
    if (!deltaPosition || !coindcxPosition) return;

    const deltaSize = Math.abs(deltaPosition.size || 0);
    const deltaContractValue = parseFloat(
      deltaPosition.product?.contract_value || 1,
    );
    const deltaQuantity = deltaSize * deltaContractValue;
    const coindcxQuantity = Math.abs(coindcxPosition.positionAmount || 0);

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

    if (qtyDiffPct > this.quantityTolerance * 100) {
      console.log("❌ QUANTITY MISMATCH → EMERGENCY EXIT");

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
    } else {
      console.log("✅ Quantity check passed");
    }
    console.log("=".repeat(60));
  }

  performFlipCheck() {
    // if (!this.latestDeltaPosition || !this.latestCoindcxPosition) return;
    // //  console.log('\n🔍 Performing Flip Safety Check...', this.latestDeltaPosition);
    // const deltaSymbol = this.latestDeltaPosition.product_symbol;
    // const coindcxSymbol =
    //   this.latestCoindcxPosition.symbol ||
    //   this.latestCoindcxPosition.contractPair;
    // const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
    // const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);
    // if (!deltaFRData || !coindcxFRData) {
    //   console.log("⏳ Waiting for both funding rates...");
    //   console.log(
    //     `   Delta symbol: ${deltaSymbol} - FR: ${deltaFRData ? "Found" : "NOT FOUND"
    //     }`
    //   );
    //   console.log(
    //     `   Coindcx symbol: ${coindcxSymbol} - FR: ${coindcxFRData ? "Found" : "NOT FOUND"
    //     }`
    //   );
    //   return;
    // }
    // // Both rates are stored as decimals, convert to percentage
    // const FR_delta = deltaFRData.rate;
    // const FR_coindcx = coindcxFRData.rate;
    // console.log("\n🔄 FLIP SAFETY CHECK");
    // console.log("─".repeat(60));
    // console.log(`Delta FR:  ${FR_delta.toFixed(4)}%`);
    // console.log(`Coindcx FR:   ${FR_coindcx.toFixed(4)}%`);
    // let FR_first, FR_second, exchange_first, exchange_second;
    // if (Math.abs(FR_delta) >= Math.abs(FR_coindcx)) {
    //   FR_first = FR_delta;
    //   FR_second = FR_coindcx;
    //   exchange_first = "Delta";
    //   exchange_second = "Coindcx";
    // } else {
    //   FR_first = FR_coindcx;
    //   FR_second = FR_delta;
    //   exchange_first = "Coindcx";
    //   exchange_second = "Delta";
    // }
    // const diff = this.calculateFundingDifference(FR_first, FR_second);
    // console.log(
    //   `Funding Rate Diff (${exchange_first} - ${exchange_second}): ${diff.toFixed(
    //     4
    //   )}%`
    // );
    // console.log(`Threshold: ${this.minProfitThreshold * 100}%`);
    // if (diff < this.minProfitThreshold * 100) {
    //   console.log("❌ FLIP DETECTED → EMERGENCY EXIT");
    //   console.log("─".repeat(60));
    //   this.emit("flip", {
    //     diff,
    //     threshold: this.minProfitThreshold * 100,
    //     FR_delta,
    //     FR_coindcx,
    //   });
    //   this.emergencyExit("FLIP_DETECTED", {
    //     reason: `Funding profit dropped to ${diff.toFixed(4)}% < threshold ${this.minProfitThreshold * 100
    //       }%`,
    //     currentDiff: diff,
    //     deltaFR: FR_delta,
    //     coindcxFR: FR_coindcx,
    //     deltaPosition: this.latestDeltaPosition,
    //     coindcxPosition: this.latestCoindcxPosition,
    //   });
    // } else {
    //   console.log(`✅ Flip safe: ${diff.toFixed(4)}% profit remains`);
    //   console.log("─".repeat(60));
    // }
  }

  /**
   * Check if both positions are still active
   * Trigger emergency exit if one side is missing for too long
   */
  async checkPositionExistence() {
    console.log("\n🔍 POSITION EXISTENCE CHECK");
    console.log("─".repeat(60));

    const ONE_SIDED_TIMEOUT_MS = 20000; // 30 seconds
    const now = Date.now();

    // Verify via REST API periodically
    await this.verifyPositionsViaREST();

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
      this.oneSidedDetectedAt = now;
      const activeSide = hasDelta ? "Delta" : "CoinDCX";
      const missingSide = hasDelta ? "CoinDCX" : "Delta";
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
      console.log("❌ ONE-SIDED TIMEOUT → EMERGENCY EXIT");
      console.log("─".repeat(60));

      const activeSide = hasDelta ? "Delta" : "CoinDCX";
      const missingSide = hasDelta ? "CoinDCX" : "Delta";

      this.emergencyExit("emergencyExit", {
        reason: "ONE_SIDED_TIMEOUT",
        activeSide,
        missingSide,
        timeoutSeconds: ONE_SIDED_TIMEOUT_MS / 1000,
        timeSinceDetection: timeSinceDetection / 1000,
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition,
        timestamp: new Date().toISOString(),
      });

      this.oneSidedDetectedAt = null;
    } else {
      console.log(`   ⏳ Remaining: ${(remainingMs / 1000).toFixed(0)}s`);
      console.log("─".repeat(60));
    }
  }

  async verifyPositionsViaREST() {
    const now = Date.now();
    const MIN_INTERVAL = 10000; // 5 seconds

    if (now - this.lastRestVerificationTime < MIN_INTERVAL) {
      return;
    }

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
      } else {
        console.log(`   Delta REST: ❌ NO ACTIVE POSITION`);
      }
    } catch (error) {
      console.error(`   Delta REST: ❌ Error - ${error.message}`);
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

    // MISMATCH DETECTION & FIX
    if (wsHasDelta && !restHasDelta) {
      console.log("\n🔴 MISMATCH: WebSocket shows Delta, REST shows NONE");
      console.log("   → Clearing stale WebSocket data");
      this.clearDeltaPosition("rest_mismatch");
    }

    if (wsHasCoindcx && !restHasCoindcx) {
      console.log("\n🔴 MISMATCH: WebSocket shows CoinDCX, REST shows NONE");
      console.log("   → Clearing stale WebSocket data");
      this.clearCoindcxPosition("rest_mismatch");
    }

    // Update from REST if WebSocket is stale
    if (!wsHasDelta && restHasDelta && activeDeltaREST) {
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
  }

  clearCoindcxPosition(reason) {
    console.log(`🧹 Clearing CoinDCX position (reason: ${reason})`);
    this.latestCoindcxPosition = null;
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

      if (currentSpread <= EXIT_SPREAD_TARGET) {
        console.log(`\n✅ SPREAD CONVERGENCE DETECTED (After Funding)!`);
        console.log(`   Target: ≤ ${EXIT_SPREAD_TARGET}%`);
        console.log(`   Actual: ${currentSpread.toFixed(4)}%`);
        // console.log(`   Time since funding: ${(timeSinceLockedFunding / 1000).toFixed(0)}s`);
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
    const sign_first = Math.sign(FR_first);
    const sign_second = Math.sign(FR_second);

    if (sign_first === sign_second) {
      return Math.abs(FR_first) - Math.abs(FR_second);
    } else {
      return Math.abs(FR_first) + Math.abs(FR_second);
    }
  }

  async emergencyExit(reason, details) {
    console.log("\n🚨🚨🚨 EMERGENCY EXIT TRIGGERED 🚨🚨🚨");
    console.log(`Reason: ${reason}`);
    console.log("=".repeat(60));

    this.emit("emergencyExit", {
      reason,
      details,
      activeTrade: this.activeTrade,
      timestamp: new Date().toISOString(),
    });

    this.unregisterTrade(); // Stop monitoring
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
  }

  async start() {
    console.log("\n🚀 Starting Enhanced Trade Monitor");
    console.log("=".repeat(60));

    this.deltaMonitor.connect();
    await this.coindcxMonitor.connect();

    // Start periodic position existence check (every 5 seconds)
    this.positionCheckInterval = setInterval(async () => {
      await this.checkPositionExistence();
    }, 5000); // Check every 5 seconds

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
