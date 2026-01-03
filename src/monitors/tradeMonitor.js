import EventEmitter from "events";
import DeltaPositionMonitor from "./deltaPositionMonitor.js";
import Pi42PositionMonitor from "./pi42PositionMonitor.js";
import config from "../config/config.js";
import CoinDCXPositionMonitor from "./coindcxPositionMonitor.js";

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

    this.flipCheckTimer = null;
    this.positionCheckInterval = null; // For periodic one-sided position checks

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
      }
    });

    this.coindcxMonitor.on("funding_rate", () => {
      if (this.latestDeltaPosition && this.latestCoindcxPosition) {
        this.checkForNormalExit();
        this.performFlipCheck();
      }
    });
  }

  async handleDeltaPosition(data) {
    const { type, position } = data;
    console.log(data)

    console.log(`\n🔔 Delta Position Event: ${type.toUpperCase()}`);
    console.log(
      `   Symbol: ${position.product_symbol} | Size: ${Math.abs(
        position.size || 0
      )}`
    );

    this.latestDeltaPosition = position;

    if (this.latestCoindcxPosition) {
      await this.performQuantityCheck(
        this.latestDeltaPosition,
        this.latestCoindcxPosition
      );
      this.performFlipCheck();
      this.checkForNormalExit(); // Check flip on every Delta update
      // Check if funding time completed
    }

    // Position existence is now checked periodically by interval timer
  }

  async handleCoindcxPosition(data) {
    const { type, position } = data;

    console.log(`\n🔔 Coindcx Position Event: ${type.toUpperCase()}`);
    console.log(
      `   Symbol: ${position.symbol || position.contractPair
      } | Amount: ${Math.abs(position.positionAmount || 0)}`
    );
    console.log('📋 DEBUG: Position fields being stored:', Object.keys(position));
    console.log('📋 DEBUG: Has mark_price?', 'mark_price' in position, position.mark_price);
    console.log('📋 DEBUG: Has avg_price?', 'avg_price' in position, position.avg_price);

    this.latestCoindcxPosition = position;

    if (this.latestDeltaPosition) {
      await this.performQuantityCheck(
        this.latestDeltaPosition,
        this.latestCoindcxPosition
      );
      this.performFlipCheck(); // Check flip on every Pi42 update
      this.checkForNormalExit(); // Check if funding time completed
    }

    // Position existence is now checked periodically by interval timer
  }

  async performQuantityCheck(deltaPosition, coindcxPosition) {
    if (!deltaPosition || !coindcxPosition) return;

    const deltaSize = Math.abs(deltaPosition.size || 0);
    const deltaContractValue = parseFloat(
      deltaPosition.product?.contract_value || 1
    );
    const deltaQuantity = deltaSize * deltaContractValue;
    const coindcxQuantity = Math.abs(coindcxPosition.positionAmount || 0);

    console.log("\n🔍 QUANTITY CHECK");
    console.log("=".repeat(60));
    console.log(
      `Delta: ${deltaQuantity.toFixed(
        4
      )} (${deltaSize} × ${deltaContractValue})`
    );
    console.log(`Coindcx:  ${coindcxQuantity.toFixed(4)}`);

    const maxQty = Math.max(deltaQuantity, coindcxQuantity);
    const qtyDiff = Math.abs(deltaQuantity - coindcxQuantity);
    const qtyDiffPct = maxQty > 0 ? (qtyDiff / maxQty) * 100 : 0;

    console.log(
      `Difference: ${qtyDiff.toFixed(4)} (${qtyDiffPct.toFixed(
        2
      )}%) | Tolerance: ${(this.quantityTolerance * 100).toFixed(1)}%`
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
        reason: `Quantity mismatch exceeds ${this.quantityTolerance * 100
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
    if (!this.latestDeltaPosition || !this.latestCoindcxPosition) return;
    //  console.log('\n🔍 Performing Flip Safety Check...', this.latestDeltaPosition);
    const deltaSymbol = this.latestDeltaPosition.product_symbol;
    const coindcxSymbol =
      this.latestCoindcxPosition.symbol ||
      this.latestCoindcxPosition.contractPair;

    const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
    const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);

    if (!deltaFRData || !coindcxFRData) {
      console.log("⏳ Waiting for both funding rates...");
      console.log(
        `   Delta symbol: ${deltaSymbol} - FR: ${deltaFRData ? "Found" : "NOT FOUND"
        }`
      );
      console.log(
        `   Coindcx symbol: ${coindcxSymbol} - FR: ${coindcxFRData ? "Found" : "NOT FOUND"
        }`
      );
      return;
    }

    // Both rates are stored as decimals, convert to percentage
    const FR_delta = deltaFRData.rate;
    const FR_coindcx = coindcxFRData.rate;

    console.log("\n🔄 FLIP SAFETY CHECK");
    console.log("─".repeat(60));
    console.log(`Delta FR:  ${FR_delta.toFixed(4)}%`);
    console.log(`Coindcx FR:   ${FR_coindcx.toFixed(4)}%`);

    let FR_first, FR_second, exchange_first, exchange_second;

    if (Math.abs(FR_delta) >= Math.abs(FR_coindcx)) {
      FR_first = FR_delta;
      FR_second = FR_coindcx;
      exchange_first = "Delta";
      exchange_second = "Coindcx";
    } else {
      FR_first = FR_coindcx;
      FR_second = FR_delta;
      exchange_first = "Coindcx";
      exchange_second = "Delta";
    }

    const diff = this.calculateFundingDifference(FR_first, FR_second);

    console.log(
      `Funding Rate Diff (${exchange_first} - ${exchange_second}): ${diff.toFixed(
        4
      )}%`
    );
    console.log(`Threshold: ${this.minProfitThreshold * 100}%`);

    if (diff < this.minProfitThreshold * 100) {
      console.log("❌ FLIP DETECTED → EMERGENCY EXIT");
      console.log("─".repeat(60));

      this.emit("flip", {
        diff,
        threshold: this.minProfitThreshold * 100,
        FR_delta,
        FR_coindcx,
      });

      this.emergencyExit("FLIP_DETECTED", {
        reason: `Funding profit dropped to ${diff.toFixed(4)}% < threshold ${this.minProfitThreshold * 100
          }%`,
        currentDiff: diff,
        deltaFR: FR_delta,
        coindcxFR: FR_coindcx,
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition,
      });
    } else {
      console.log(`✅ Flip safe: ${diff.toFixed(4)}% profit remains`);
      console.log("─".repeat(60));
    }
  }

  /**
   * Check if both positions are still active
   * Trigger emergency exit if one side is missing for too long
   */
  async checkPositionExistence() {
    // if (!this.activeTrade) return;

    console.log("Checking for position: +++++++++")

    const ONE_SIDED_TIMEOUT_MS = 30000; // 30 seconds grace period
    const now = Date.now();

    // Track when position went missing
    if (!this.oneSidedDetectedAt) {
      this.oneSidedDetectedAt = null;
    }

    // Check Delta position
    const hasDeltaPosition = this.latestDeltaPosition &&
                            Math.abs(this.latestDeltaPosition.size || 0) > 0;

    // Check CoinDCX position
    const hasCoindcxPosition = this.latestCoindcxPosition &&
                              Math.abs(this.latestCoindcxPosition.positionAmount || 0) > 0;

    console.log("\n🔍 POSITION EXISTENCE CHECK");
    console.log("─".repeat(60));
    console.log(`   Delta Position: ${hasDeltaPosition ? '✅ Active' : '❌ Missing'}`);
    console.log(`   CoinDCX Position: ${hasCoindcxPosition ? '✅ Active' : '❌ Missing'}`);

    // Both positions active - reset timer and return
    if (hasDeltaPosition && hasCoindcxPosition) {
      if (this.oneSidedDetectedAt) {
        console.log(`   ✅ Both positions restored`);
        this.oneSidedDetectedAt = null;
      }
      console.log("─".repeat(60));
      return;
    }

    // Both positions missing - reset timer and return (nothing to monitor)
    if (!hasDeltaPosition && !hasCoindcxPosition) {
      if (this.oneSidedDetectedAt) {
        console.log(`   ℹ️ Both positions closed - stopping one-sided monitor`);
        this.oneSidedDetectedAt = null;
      }
      console.log("─".repeat(60));
      return;
    }

    // One-sided detected
    if (!this.oneSidedDetectedAt) {
      // First detection - start timer
      this.oneSidedDetectedAt = now;
      console.log(`   ⚠️ One-sided position detected! Starting ${ONE_SIDED_TIMEOUT_MS/1000}s grace period...`);
      console.log("─".repeat(60));
      return;
    }

    // Check timeout
    const timeSinceDetection = now - this.oneSidedDetectedAt;
    const remainingMs = ONE_SIDED_TIMEOUT_MS - timeSinceDetection;

    console.log(`   ⏱️ One-sided for ${(timeSinceDetection/1000).toFixed(0)}s / ${ONE_SIDED_TIMEOUT_MS/1000}s`);

    if (timeSinceDetection >= ONE_SIDED_TIMEOUT_MS) {
      console.log("❌ ONE-SIDED TIMEOUT → EMERGENCY EXIT");
      console.log("─".repeat(60));

      // Determine which side is active
      const activeSide = hasDeltaPosition ? 'Delta' : 'CoinDCX';
      const missingSide = hasDeltaPosition ? 'CoinDCX' : 'Delta';

      this.emit("oneSidedPosition", {
        activeSide,
        missingSide,
        timeSinceDetection: timeSinceDetection / 1000,
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition,
      });

      await this.emergencyExit("ONE_SIDED_POSITION", {
        reason: `One-sided position detected: ${activeSide} active, ${missingSide} missing for ${(timeSinceDetection/1000).toFixed(0)}s`,
        activeSide,
        missingSide,
        timeoutSeconds: ONE_SIDED_TIMEOUT_MS / 1000,
        timeSinceDetection: timeSinceDetection / 1000,
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition,
      });

      this.oneSidedDetectedAt = null; // Reset
    } else {
      console.log(`   ⏳ Grace period remaining: ${(remainingMs/1000).toFixed(0)}s`);
      console.log("─".repeat(60));
    }
  }

  checkForNormalExit() {
    if (!this.latestDeltaPosition || !this.latestCoindcxPosition) return;

    // ============================================================
    // 📅 STEP 1: GET FUNDING TIME INFO FIRST
    // ============================================================
    const deltaSymbol = this.latestDeltaPosition.product_symbol;
    const frData = this.deltaMonitor.getFundingRate(deltaSymbol);

    if (!frData || !frData.nextFundingTime) {
      console.log("⏳ Waiting for Delta funding rate data...");
      return;
    }

    // Convert Date object to timestamp (nextFundingTime is a Date object, not a number)
    const fundingTimeMs = frData.nextFundingTime instanceof Date
      ? frData.nextFundingTime.getTime()
      : new Date(frData.nextFundingTime).getTime();

    if (Number.isNaN(fundingTimeMs)) {
      console.error("❌ Invalid funding time format:", frData.nextFundingTime);
      return;
    }

    const now = Date.now();
    const timeUntilFunding = fundingTimeMs - now;

    console.log(`\n📅 Funding Schedule:`);
    console.log(`   Current Time: ${new Date(now).toLocaleString("en-IN")}`);
    console.log(`   Next Funding: ${new Date(fundingTimeMs).toLocaleString("en-IN")}`);
    console.log(`   Time Until Funding: ${(timeUntilFunding / 1000).toFixed(0)}s (${(timeUntilFunding / 60000).toFixed(1)} minutes)`);

    // ============================
    // STEP 2: WAIT UNTIL FUNDING TIME HAS PASSED
    // ============================
    if (timeUntilFunding > 0) {
      const minutes = Math.floor(timeUntilFunding / 60000);
      const seconds = Math.floor((timeUntilFunding % 60000) / 1000);
      console.log(`⏳ Waiting for funding... ${minutes}m ${seconds}s remaining`);
      console.log(`   → Spread exit is DISABLED until funding completes`);
      console.log(`   → Exit logic will activate AFTER funding time\n`);

      // Reset locked funding time if we're still before funding
      this.lockedFundingTime = null;
      this.fundingConfirmedAt = null;
      return; // Don't proceed with ANY exit checks until funding passes
    }

    // ============================
    // 2️⃣ FUNDING TIME HAS PASSED - LOCK IT ONCE
    // ============================
    if (!this.lockedFundingTime) {
      this.lockedFundingTime = fundingTimeMs; // Use ACTUAL funding time, not Date.now()
      this.lastRealizedFunding = Number(
        this.latestDeltaPosition.realized_funding || 0
      );

      console.log("\n🕒 FUNDING TIME REACHED!");
      console.log(`   Locked At: ${new Date(this.lockedFundingTime).toLocaleString("en-IN")}`);
      console.log(`   Initial Realized Funding: $${this.lastRealizedFunding.toFixed(4)}`);
      console.log(`   → Starting exit window monitoring\n`);
    }

    const timeSinceLockedFunding = now - this.lockedFundingTime;
    console.log(`\n⏱️  Time since funding: ${(timeSinceLockedFunding / 1000).toFixed(0)}s (${(timeSinceLockedFunding / 60000).toFixed(1)} minutes)`);

    // ============================
    // 3️⃣ WAIT FOR FUNDING SETTLEMENT (Optional buffer for settlement)
    // ============================
    const FUNDING_SETTLEMENT_BUFFER = 30000; // 30 seconds for funding to settle

    if (timeSinceLockedFunding < FUNDING_SETTLEMENT_BUFFER) {
      const currentRealizedFunding = Number(this.latestDeltaPosition.realized_funding || 0);

      console.log(`\n⏳ Waiting for funding settlement buffer (${FUNDING_SETTLEMENT_BUFFER/1000}s)...`);
      console.log(`   Last Realized Funding: $${this.lastRealizedFunding.toFixed(4)}`);
      console.log(`   Current Realized Funding: $${currentRealizedFunding.toFixed(4)}`);

      // Check if funding was credited
      if (currentRealizedFunding !== this.lastRealizedFunding) {
        if (!this.fundingConfirmedAt) {
          this.fundingConfirmedAt = now;
          const fundingReceived = currentRealizedFunding - this.lastRealizedFunding;
          console.log(`\n💰 FUNDING SETTLEMENT DETECTED!`);
          console.log(`   Amount Received: $${fundingReceived.toFixed(4)}`);
          console.log(`   Confirmed At: ${new Date(this.fundingConfirmedAt).toLocaleString("en-IN")}`);
        }
      }

      const bufferRemaining = FUNDING_SETTLEMENT_BUFFER - timeSinceLockedFunding;
      console.log(`   Buffer remaining: ${(bufferRemaining / 1000).toFixed(0)}s`);
      console.log(`   → Will check exit conditions after buffer\n`);
      return; // Wait for buffer to complete
    }

    // ============================
    // 4️⃣ CHECK EXIT CONDITIONS (After funding + settlement buffer)
    // ============================
    const MAX_WAIT_AFTER_FUNDING_MS = 60 * 60 * 1000; // 60 minutes max

    // ============================================================
    // 🎯 SPREAD-BASED EXIT CHECK (AFTER FUNDING)
    // This check runs ONLY after funding time has passed
    // Exit Rule: Spread ≤ 0.05%
    // ============================================================
    const deltaMarkPrice = this.latestDeltaPosition.mark_price;
    const coindcxMarkPrice = this.latestCoindcxPosition.mark_price;

    if (deltaMarkPrice && coindcxMarkPrice) {
      const priceDifference = coindcxMarkPrice - deltaMarkPrice;
      const currentSpread = Math.abs(priceDifference / deltaMarkPrice) * 100;

      console.log('\n📊 SPREAD MONITORING (Post-Funding)');
      console.log('━'.repeat(60));
      console.log(`   Delta Mark Price:   $${deltaMarkPrice.toFixed(8)}`);
      console.log(`   CoinDCX Mark Price: $${coindcxMarkPrice.toFixed(8)}`);
      console.log(`   Price Difference:   $${priceDifference.toFixed(8)} (${priceDifference >= 0 ? '+' : ''}${((priceDifference / deltaMarkPrice) * 100).toFixed(4)}%)`);
      console.log(`   Current Spread:     ${currentSpread.toFixed(4)}%`);

      const EXIT_SPREAD_TARGET = 0.05; // 0.05%

      // Check if spread has converged to target or lower
      if (currentSpread <= EXIT_SPREAD_TARGET) {
        console.log(`\n✅ SPREAD CONVERGENCE DETECTED (After Funding)!`);
        console.log(`   Target: ≤ ${EXIT_SPREAD_TARGET}%`);
        console.log(`   Actual: ${currentSpread.toFixed(4)}%`);
        console.log(`   Time since funding: ${(timeSinceLockedFunding / 1000).toFixed(0)}s`);
        console.log(`   → Triggering EXIT`);
        console.log('━'.repeat(60));

        const coindcxSymbol = this.latestCoindcxPosition.symbol || this.latestCoindcxPosition.contractPair;
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

      console.log(`   Status: Spread ${currentSpread.toFixed(4)}% > ${EXIT_SPREAD_TARGET}% → Continue monitoring`);
      console.log('━'.repeat(60));
    }
    // ============================================================

    const deltaPnL = this.latestDeltaPosition.unrealized_pnl || 0;
    const coindcxPnL = this.calculateCoindcxUnrealizedPnL(
      this.latestCoindcxPosition
    );
    const totalPnL = deltaPnL + coindcxPnL;

    console.log("\n💰 P&L Status (Post-Funding):");
    console.log(`   Delta unrealized P&L: $${deltaPnL.toFixed(4)}`);
    console.log(`   CoinDCX unrealized P&L: $${coindcxPnL.toFixed(4)}`);
    console.log(`   Combined P&L: $${totalPnL.toFixed(4)}`);

    // ✅ PROFIT TARGET CHECK (Exit Condition B: Total PnL >= 0)
    if (totalPnL >= 0) {
      console.log("\n✅ PROFIT TARGET REACHED → EXECUTING EXIT");
      console.log(`   Combined P&L: $${totalPnL.toFixed(4)} >= $0`);
      console.log(`   → Exiting after funding completion`);

      const coindcxSymbol = this.latestCoindcxPosition.symbol || this.latestCoindcxPosition.contractPair;
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

    // ✅ BOTH POSITIONS POSITIVE (Alternative profit check)
    if (deltaPnL >= 0 && coindcxPnL >= 0) {
      console.log("\n✅ BOTH POSITIONS PROFITABLE → EXECUTING EXIT");
      console.log(`   Delta P&L: $${deltaPnL.toFixed(4)} >= $0`);
      console.log(`   CoinDCX P&L: $${coindcxPnL.toFixed(4)} >= $0`);
      console.log(`   Combined P&L: $${totalPnL.toFixed(4)}`);

      const coindcxSymbol = this.latestCoindcxPosition.symbol || this.latestCoindcxPosition.contractPair;
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


    // ⏱️ TIMEOUT EXIT (Force exit if waited too long after funding)
    if (timeSinceLockedFunding >= MAX_WAIT_AFTER_FUNDING_MS) {
      console.log("\n⚠️ EMERGENCY TIMEOUT → FORCING EXIT");
      console.log(`   Funding time: ${new Date(this.lockedFundingTime).toLocaleString("en-IN")}`);
      console.log(`   Time elapsed: ${(timeSinceLockedFunding / 60000).toFixed(1)} minutes`);
      console.log(`   Current P&L: $${totalPnL.toFixed(4)}`);
      console.log(`   → Maximum wait time (${MAX_WAIT_AFTER_FUNDING_MS/60000} minutes) exceeded`);

      const coindcxSymbol = this.latestCoindcxPosition.symbol || this.latestCoindcxPosition.contractPair;
      const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
      const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);

      this.emergencyExit("TIMEOUT_EXIT", {
        reason: `Emergency timeout: ${(MAX_WAIT_AFTER_FUNDING_MS/60000)} minutes after funding without profit target`,
        totalPnL: totalPnL,
        deltaPnL: deltaPnL,
        coindcxPnL: coindcxPnL,
        fundingTime: this.lockedFundingTime,
        fundingConfirmedAt: this.fundingConfirmedAt,
        timeSinceLockedFunding: (timeSinceLockedFunding / 60000).toFixed(1),
        deltaFR: deltaFRData ? deltaFRData.rate : null,
        coindcxFR: coindcxFRData ? coindcxFRData.rate : null,
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition,
      });

      this.resetFundingState();
      return;
    }

    // Still monitoring - waiting for profit target
    const elapsedMinutes = (timeSinceLockedFunding / 60000).toFixed(1);
    const remainingMinutes = ((MAX_WAIT_AFTER_FUNDING_MS - timeSinceLockedFunding) / 60000).toFixed(1);

    console.log(`\n⏳ Monitoring for profit target...`);
    console.log(`   Elapsed: ${elapsedMinutes} minutes | Remaining: ${remainingMinutes} minutes`);
    console.log(`   Current P&L: $${totalPnL.toFixed(4)}`);
    console.log(`   Target: Total PnL >= $0 OR Both positions >= $0`);
    console.log(`   → Will continue monitoring until profit target or timeout\n`);
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
    const unrealizedPnl = parseFloat(position.unrealised_pnl || position.unrealisedPnl || position.pnl || 0);

    console.log(`📊 CoinDCX PnL: $${unrealizedPnl.toFixed(4)} (from ${position.symbol || position.pair})`);

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
      `Delta: ${trade.deltaSymbol} | Coindcx: ${trade.coindexSymbol}`
    );
    console.log("=".repeat(60));

    this.activeTrade = {
      ...trade,
      registeredAt: Date.now(),
    };

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
      "✅ Monitor active: Quantity + Flip + Normal Exit + One-Sided protection enabled"
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
