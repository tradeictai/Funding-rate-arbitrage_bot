import deltaAPI from "../services/deltaAPI.js";
import pi42API from "../services/pi42API.js";
import config from "../config/config.js";
import mongoService from "../services/mongoService.js";
import coindcxAPI from "../services/coindcxAPI.js";
import positionSizer from "./positionSizer.js";

/**
 * Exit Manager - Phase 5
 * Handles both normal exits (after funding) and emergency exits
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ExitManager {
  constructor() {
    this.maxWaitForFunding = config.trading.maxWaitForFundingSeconds * 1000; // Convert to ms
    this.pollInterval = config.trading.pollIntervalSeconds * 1000; // Convert to ms
    this.orderbookDepth = config.trading.orderbookDepth || 20;
    this.maxRetries = 5;
    this.exitRetryAttempts = 3; // 1 try + 2 retries
    this.exitRetryDelayMs = 2000;
  }

  /**
   * Check if funding has been credited on Delta
   * @param {string} symbol - Symbol to check
   * @param {number} startTime - Start time to check from
   * @returns {Promise<Object>} - { credited: boolean, amount: number, timestamp: number }
   */
  async checkDeltaFundingCredit(symbol, startTime) {
    try {
      // Get funding ledger from Delta
      // Note: This would need to be implemented based on Delta's funding history API
      // For now, we'll use a placeholder that checks position updates

      const position = await deltaAPI.getPosition(symbol);

      if (!position) {
        return { credited: false, amount: 0 };
      }

      // Check if realized PnL increased (indicates funding credit)
      // This is a simplified check - in production, you'd want to query the funding ledger

      return {
        credited: false, // Placeholder - needs actual implementation
        amount: 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("Error checking Delta funding credit:", error.message);
      return { credited: false, amount: 0 };
    }
  }

  /**
   * Check if funding has been credited on Pi42
   * @param {string} symbol - Symbol to check
   * @param {number} startTime - Start time to check from
   * @returns {Promise<Object>} - { credited: boolean, amount: number, timestamp: number }
   */
  async checkPi42FundingCredit(symbol, startTime) {
    try {
      // Get position for symbol
      const position = await pi42API.getPosition(symbol);

      if (!position) {
        return { credited: false, amount: 0 };
      }

      // Placeholder - needs actual implementation based on Pi42's funding history
      return {
        credited: false,
        amount: 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("Error checking Pi42 funding credit:", error.message);
      return { credited: false, amount: 0 };
    }
  }

  /**
   * Wait for funding credit with timeout
   * @param {Object} trade - Active trade object
   * @returns {Promise<Object>} - { success: boolean, deltaCredit: Object, pi42Credit: Object }
   */
  async waitForFundingCredit(trade) {
    console.log("\n⏳ WAITING FOR FUNDING CREDIT");
    console.log("=".repeat(60));
    console.log(`Max wait time: ${this.maxWaitForFunding / 1000}s`);
    console.log(`Poll interval: ${this.pollInterval / 1000}s`);
    console.log("=".repeat(60));

    const startTime = Date.now();
    const endTime = startTime + this.maxWaitForFunding;

    while (Date.now() < endTime) {
      // Check both exchanges for funding credit
      const [deltaCredit, pi42Credit] = await Promise.all([
        this.checkDeltaFundingCredit(trade.deltaSymbol, startTime),
        this.checkPi42FundingCredit(trade.pi42Symbol, startTime),
      ]);

      console.log("\n📊 Funding Credit Check:");
      console.log(
        `   Delta: ${deltaCredit.credited ? "✅ Credited" : "⏳ Waiting..."}`,
      );
      console.log(
        `   Pi42:  ${pi42Credit.credited ? "✅ Credited" : "⏳ Waiting..."}`,
      );

      // If both credited, return success
      if (deltaCredit.credited && pi42Credit.credited) {
        console.log("\n✅ FUNDING CREDITED ON BOTH EXCHANGES");
        console.log("=".repeat(60));
        return {
          success: true,
          deltaCredit,
          pi42Credit,
        };
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, this.pollInterval));

      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = (endTime - Date.now()) / 1000;
      console.log(
        `   Elapsed: ${elapsed.toFixed(0)}s | Remaining: ${remaining.toFixed(
          0,
        )}s`,
      );
    }

    // Timeout reached
    console.log("\n⚠️  TIMEOUT: Max wait time reached without funding credit");
    console.log("=".repeat(60));

    return {
      success: false,
      reason: "Timeout waiting for funding credit",
      elapsed: (Date.now() - startTime) / 1000,
    };
  }

  /**
   * Execute market exit on Delta with retry logic
   * @param {Object} position - Position to close
   * @param {number} exitPrice - Exit price (ignored, always uses market)
   * @returns {Promise<Object>} - Exit order result
   */
  async exitDeltaPosition(position, exitPrice = null) {
    // 🔒 VALIDATION: Ensure position actually exists and has size > 0
    if (!position || !position.details || !position.details.deltaPosition) {
      console.log("⚠️ Delta position data missing - skipping exit");
      return {
        success: false,
        exchange: "delta",
        error: "Position data missing",
        skipped: true,
      };
    }

    const positionSize = Math.abs(position.details.deltaPosition.size || 0);
    if (positionSize === 0) {
      console.log(
        "⚠️ Delta position size is 0 - already closed, skipping exit",
      );
      return {
        success: true,
        exchange: "delta",
        message: "Position already closed (size = 0)",
        skipped: true,
      };
    }

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(
          `\n📤 Exiting Delta position (Attempt ${attempt}/${this.maxRetries}):`,
        );
        console.log("Position details:", position);

        const size = positionSize; // Already validated above
        const side =
          position.details.deltaPosition.side === "LONG" ? "sell" : "buy"; // Opposite side to close

        // ALWAYS use market order to avoid open order issues
        const orderType = "market_order";

        const orderParams = {
          productId: position.details.deltaPosition.product_id,
          symbol: position.details.deltaPosition.product_symbol,
          side: side,
          orderType: orderType,
          size: size,
          limitPrice: null, // No price for market order
          postOnly: false,
          reduceOnly: true, // Important: reduce only to close position
        };

        console.log(
          "   Order type:",
          orderType,
          "(market order - immediate execution)",
        );
        console.log("   Side:", side);
        console.log("   Size:", size);

        const result = await deltaAPI.placeOrder(orderParams);

        console.log("✅ Delta exit order placed successfully");

        return {
          success: true,
          exchange: "delta",
          orderId: result.id,
          symbol: position.details.deltaPosition.product_symbol,
          side: side,
          size: size,
          orderType: orderType,
          exitPrice: exitPrice,
          result: result,
        };
      } catch (error) {
        console.error(
          `❌ Delta exit attempt ${attempt}/${this.maxRetries} failed:`,
          error.message,
        );

        // If this is the last attempt, return failure
        if (attempt >= this.maxRetries) {
          console.error(
            `❌ All ${this.maxRetries} attempts failed for Delta exit`,
          );
          return {
            success: false,
            exchange: "delta",
            error: error.message,
            attempts: attempt,
          };
        }

        // RETRY LOGIC
        console.log(`\n🔄 Initiating retry logic for Delta exit...`);

        try {
          const symbol = position.details.deltaPosition.product_symbol;
          const productId = position.details.deltaPosition.product_id;

          // Step 1: Check for open orders
          console.log(`   Step 1: Checking for open orders...`);
          const openOrders = await deltaAPI.getOpenOrders();

          // Step 2: Cancel all open orders if any exist
          if (openOrders && openOrders.length > 0) {
            console.log(
              `   Step 2: Found ${openOrders.length} open orders, canceling all...`,
            );
            await deltaAPI.cancelAllOrders();
            console.log(`   ✅ All open orders canceled`);
            await sleep(2000); // Wait for cancellation to complete
          } else {
            console.log(`   Step 2: No open orders found`);
          }

          // Step 3: Market orders don't need price recalculation
          console.log(
            `   Step 3: Using market order - no price recalculation needed`,
          );

          console.log(`   Retrying exit with market order...`);
        } catch (retryError) {
          console.error(`   ❌ Retry preparation failed:`, retryError.message);
          // Continue to next attempt even if retry preparation fails
        }

        // Small delay before retry
        await sleep(1000);
      }
    }
  }

  /**
   * Execute limit exit on CoinDCX with retry logic
   * @param {Object} position - Position to close
   * @param {number} exitPrice - Exit price
   * @returns {Promise<Object>} - Exit order result
   */
  // async exitCoinDCXPosition(position, exitPrice = null) {
  //   for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
  //     try {
  //       console.log(`\n📤 Exiting CoinDCX position (Attempt ${attempt}/${this.maxRetries}):`);
  //       console.log("Position details:", position);

  //       const pair = position.details.coindcxPosition.pair || position.details.coindcxPosition.symbol;
  //       const positionId = position.details.coindcxPosition.id;

  //       if (!positionId) {
  //         throw new Error("Position ID required to exit");
  //       }

  //       const leverage = Number(position.details.coindcxPosition.leverage) || 10;
  //       const size = Math.abs(
  //         position.details.coindcxPosition.active_pos ||
  //           position.details.coindcxPosition.size ||
  //           0
  //       );
  //       const sideToClose = position.details.coindcxPosition.side === "SHORT" ? "buy" : "sell"; // Opposite

  //       // Determine order type
  //       const orderType = exitPrice ? "limit_order" : "market_order";

  //       const orderParams = {
  //         order: {
  //           pair: pair,
  //           side: sideToClose,
  //           order_type: orderType,
  //           total_quantity: size,
  //           leverage: leverage,
  //           notification: "no_notification",
  //           position_margin_type: position.details.coindcxPosition.margin_type || "crossed",
  //           margin_currency_short_name: position.details.coindcxPosition.margin_currency_short_name || "USDT",
  //         },
  //       };

  //       // Add price for limit orders
  //       if (orderType === 'limit_order') {
  //         orderParams.order.price = exitPrice;
  //         orderParams.order.time_in_force = 'good_till_cancel';
  //       }

  //       console.log(`   Pair: ${pair}`);
  //       console.log(`   Side: ${sideToClose}`);
  //       console.log(`   Quantity: ${size}`);
  //       console.log(`   Order type: ${orderType}`);
  //       if (exitPrice) console.log(`   Exit price: ${exitPrice}`);

  //       const result = await coindcxAPI.placeOrder(orderParams);

  //       console.log("✅ CoinDCX exit order placed successfully");

  //       return {
  //         success: true,
  //         exchange: "coindcx",
  //         orderId: result[0]?.id || result.id,
  //         symbol: pair,
  //         side: sideToClose,
  //         quantity: size,
  //         orderType: orderType,
  //         exitPrice,
  //         result,
  //       };

  //     } catch (error) {
  //       console.error(`❌ CoinDCX exit attempt ${attempt}/${this.maxRetries} failed:`, error.message);

  //       // If this is the last attempt, return failure
  //       if (attempt >= this.maxRetries) {
  //         console.error(`❌ All ${this.maxRetries} attempts failed for CoinDCX exit`);
  //         return {
  //           success: false,
  //           exchange: "coindcx",
  //           error: error.message,
  //           attempts: attempt
  //         };
  //       }

  //       // RETRY LOGIC
  //       console.log(`\n🔄 Initiating retry logic for CoinDCX exit...`);

  //       try {
  //         const pair = position.details.coindcxPosition.pair || position.details.coindcxPosition.symbol;

  //         // Step 1: Check for open orders
  //         console.log(`   Step 1: Checking for open orders...`);
  //         const openOrders = await coindcxAPI.getActiveFuturesOrders({ status: 'open' });

  //         // Step 2: Cancel all open orders if any exist
  //         if (openOrders && openOrders.length > 0) {
  //           console.log(`   Step 2: Found ${openOrders.length} open orders, canceling all...`);
  //           await coindcxAPI.cancelAllFuturesOpenOrders();
  //           console.log(`   ✅ All open orders canceled`);
  //           await sleep(2000); // Wait for cancellation to complete
  //         } else {
  //           console.log(`   Step 2: No open orders found`);
  //         }

  //         // Step 3: Recalculate price from fresh orderbook (only for limit orders)
  //         if (exitPrice) {
  //           console.log(`   Step 3: Recalculating exit price from fresh orderbook...`);

  //           const orderbookRaw = await coindcxAPI.getOrderbook(pair, this.orderbookDepth);
  //           const orderbook = positionSizer.normalizeOrderbook(orderbookRaw, 'coindcx');

  //           const coindcxSide = position.details.coindcxPosition.positionType === 'SHORT' ? 'buy' : 'sell';
  //           const quantity = position.details.coindcxPosition.size;

  //           const result = positionSizer.calculateTradingPriceFromOrderbook(
  //             orderbook,
  //             coindcxSide,
  //             quantity
  //           );

  //           exitPrice = result.tradingPrice;
  //           console.log(`   ✅ New exit price calculated: ${exitPrice}`);
  //         } else {
  //           console.log(`   Step 3: Skipping price recalculation (market order)`);
  //         }

  //         console.log(`   Retrying exit with updated parameters...`);

  //       } catch (retryError) {
  //         console.error(`   ❌ Retry preparation failed:`, retryError.message);
  //         // Continue to next attempt even if retry preparation fails
  //       }

  //       // Small delay before retry
  //       await sleep(1000);
  //     }
  //   }
  // }

  async exitCoinDCXPosition(position, exitPrice = null) {
    console.log("postions: ", position);

    // 🔒 VALIDATION: Ensure position actually exists and has size > 0
    if (!position || !position.details || !position.details.coindcxPosition) {
      console.log("⚠️ CoinDCX position data missing - skipping exit");
      return {
        success: false,
        exchange: "coindcx",
        error: "Position data missing",
        skipped: true,
      };
    }

    const positionSize = Math.abs(
      position.details.coindcxPosition.active_pos ||
        position.details.coindcxPosition.size ||
        0,
    );

    if (positionSize === 0) {
      console.log(
        "⚠️ CoinDCX position size is 0 - already closed, skipping exit",
      );
      return {
        success: true,
        exchange: "coindcx",
        message: "Position already closed (size = 0)",
        skipped: true,
      };
    }

    const pair =
      position.details.coindcxPosition.pair ||
      position.details.coindcxPosition.symbol;
    console.log(`\n📤 Exiting CoinDCX position: ${pair}`);

    const positionId = position.details.coindcxPosition.id;
    if (!positionId) {
      return {
        success: false,
        exchange: "coindcx",
        error: "Position ID required to exit",
      };
    }

    const leverage = Number(position.details.coindcxPosition.leverage) || 10;
    const size = positionSize; // Already validated above
    const sideToClose =
      position.details.coindcxPosition.side === "SHORT" ? "buy" : "sell"; // Opposite

    for (let attempt = 1; attempt <= this.exitRetryAttempts; attempt++) {
      try {
        const orderParams = {
          order: {
            pair: pair,
            side: sideToClose,
            order_type: "market_order",
            total_quantity: size,
            leverage: leverage,
            notification: "no_notification",
            position_margin_type: position.margin_type || "crossed",
            margin_currency_short_name:
              position.margin_currency_short_name || "USDT",
          },
        };

        const result = await coindcxAPI.placeOrder(orderParams);

        console.log(
          `✅ CoinDCX market exit order placed (Attempt ${attempt}/${this.exitRetryAttempts})`,
        );

        return {
          success: true,
          exchange: "coindcx",
          orderId: result.id,
          symbol: pair,
          side: sideToClose,
          quantity: size,
          orderType: "market",
          result,
        };
      } catch (error) {
        console.error(
          `❌ CoinDCX exit attempt ${attempt}/${this.exitRetryAttempts} failed:`,
          error.message,
        );

        if (attempt >= this.exitRetryAttempts) {
          return {
            success: false,
            exchange: "coindcx",
            error: error.message,
            attempts: attempt,
          };
        }

        console.log(
          `⏳ Retrying CoinDCX exit in ${this.exitRetryDelayMs / 1000}s...`,
        );
        await sleep(this.exitRetryDelayMs);
      }
    }

    // Market full close via Exit endpoint
    // console.log(`   Using Market Exit for full position close`);
    // console.log(`   Position ID: ${positionId}`);

    // const body = { id: positionId };

    // const result = await this.privateRequest(
    //   'POST',
    //   '/exchange/v1/derivatives/futures/positions/exit',
    //   body,
    //   true,  // trade credentials
    //   true   // Buffer format
    // );

    // console.log('✅ CoinDCX position fully closed');

    // return {
    //   success: true,
    //   exchange: 'coindcx',
    //   groupId: result.group_id,
    //   symbol: position.pair || position.symbol,
    //   orderType: 'market_exit',
    //   result
    // };
    return {
      success: false,
      exchange: "coindcx",
      error: "CoinDCX exit failed after retries",
    };
  }
  /**
   * Normal exit after funding credit (market orders)
   * @param {Object} trade - Active trade object
   * @param {Object} deltaPosition - Delta position
   * @param {Object} pi42Position - Pi42 position
   * @returns {Promise<Object>} - Exit result
   */
  async executeNormalExit(trade, deltaPosition, coindcxPosition) {
    console.log("\n" + "=".repeat(60));
    console.log("🎯 EXECUTING NORMAL EXIT (POST-FUNDING)");
    console.log("=".repeat(60));

    try {
      // Wait for funding credit
      // const fundingResult = await this.waitForFundingCredit(trade);

      // if (!fundingResult.success) {
      //   console.log('⚠️  Funding not credited within timeout');
      //   console.log('   Switching to immediate market exit for safety');

      //   // Fall back to emergency exit
      //   return await this.executeEmergencyExit(trade, deltaPosition, pi42Position, {
      //     reason: 'Funding credit timeout',
      //     details: fundingResult
      //   });
      // }

      // Funding credited, proceed with market exits
      console.log("\n📊 Executing market exits on both exchanges...");

      // Calculate exit prices (could use current market price or a slight improvement)
      // const deltaExitPrice = deltaPosition.mark_price; // Could add spread for better execution
      // const pi42ExitPrice = pi42Position.markPrice;

      // Place exit orders on both exchanges
      const [deltaExit, coindcxExit] = await Promise.all([
        this.exitDeltaPosition(trade, trade.deltaPosition),
        this.exitCoinDCXPosition(trade, trade.coindcxPosition),
      ]);

      // Check results
      if (!deltaExit.success || !coindcxExit.success) {
        console.error("\n❌ One or more exit orders failed:");
        if (!deltaExit.success) console.error(`   Delta: ${deltaExit.error}`);
        if (!coindcxExit.success)
          console.error(`   Coindcx: ${coindcxExit.error}`);

        return {
          success: false,
          stage: "exit_orders",
          deltaExit,
          coindcxExit,
          reason: "One or more exit orders failed",
        };
      }

      console.log("\n✅ NORMAL EXIT COMPLETED SUCCESSFULLY");
      console.log("=".repeat(60));

      // Store exit result
      const exitResult = {
        success: true,
        type: "normal_exit",
        deltaExit,
        coindcxExit,
        fundingCredit: null,
        exitTime: new Date().toISOString(),
      };

      // Persist to MongoDB
      await mongoService.storeExitResult(exitResult);

      return exitResult;
    } catch (error) {
      console.error("\n❌ Normal exit failed:", error.message);

      // Fall back to emergency exit
      return await this.executeEmergencyExit(
        trade,
        trade.deltaPosition,
        trade.coindcxPosition,
        {
          reason: "Normal exit error",
          error: error.message,
        },
      );
    }
  }

  /**
   * Emergency exit (immediate market orders)
   * @param {Object} trade - Active trade object
   * @param {Object} deltaPosition - Delta position
   * @param {Object} pi42Position - Pi42 position
   * @param {Object} reason - Reason for emergency exit
   * @returns {Promise<Object>} - Exit result
   */
  async executeEmergencyExit(trade, deltaPosition, pi42Position, reason) {
    console.log("\n" + "🚨".repeat(30));
    console.log("🚨 EXECUTING EMERGENCY EXIT 🚨");
    console.log("🚨".repeat(30));
    console.log("Reason:", reason.reason);
    console.log("Details:", JSON.stringify(reason.details || {}, null, 2));
    console.log("=".repeat(60));

    try {
      console.log("\n📊 Placing exit orders...");

      // Check which positions exist
      const hasDeltaPosition =
        trade.details?.deltaPosition?.size &&
        Math.abs(trade.details.deltaPosition.size) > 0;
      const hasCoindcxPosition =
        trade.details?.coindcxPosition?.size &&
        Math.abs(trade.details.coindcxPosition.size) > 0;

      console.log(`   Delta Position: ${hasDeltaPosition ? "Active" : "None"}`);
      console.log(
        `   CoinDCX Position: ${hasCoindcxPosition ? "Active" : "None"}`,
      );

      let deltaExit = { success: true, message: "No position to exit" };
      let coindcxExit = { success: true, message: "No position to exit" };

      // Exit Delta if position exists
      if (hasDeltaPosition) {
        deltaExit = await this.exitDeltaPosition(trade, trade.deltaPosition);
      } else {
        console.log("   ⏭️ Skipping Delta exit (no position)");
      }

      // Exit CoinDCX if position exists
      if (hasCoindcxPosition) {
        coindcxExit = await this.exitCoinDCXPosition(
          trade,
          trade.coindcxPosition,
        );
      } else {
        console.log("   ⏭️ Skipping CoinDCX exit (no position)");
      }

      // Check if any actual exit failed
      const hadFailure =
        (hasDeltaPosition && !deltaExit.success) ||
        (hasCoindcxPosition && !coindcxExit.success);

      if (hadFailure) {
        console.error(
          "\n❌ CRITICAL: One or more emergency exit orders failed:",
        );
        if (hasDeltaPosition && !deltaExit.success)
          console.error(`   Delta: ${deltaExit.error}`);
        if (hasCoindcxPosition && !coindcxExit.success)
          console.error(`   CoinDCX: ${coindcxExit.error}`);

        return {
          success: false,
          type: "emergency_exit",
          stage: "exit_orders",
          deltaExit,
          coindcxExit,
          reason: reason.reason,
          details: reason.details,
        };
      }

      console.log("\n✅ EMERGENCY EXIT COMPLETED");
      console.log("=".repeat(60));

      // Store exit result
      const exitResult = {
        success: true,
        type: "emergency_exit",
        deltaExit,
        coindcxExit,
        reason: reason.reason,
        details: reason.details,
        exitTime: new Date().toISOString(),
      };

      // Persist to MongoDB
      await mongoService.storeExitResult(exitResult);

      return exitResult;
    } catch (error) {
      console.error("\n❌ CRITICAL: Emergency exit failed:", error.message);
      console.error(error.stack);

      return {
        success: false,
        type: "emergency_exit",
        stage: "critical_error",
        error: error.message,
        reason: reason.reason,
        details: reason.details,
      };
    }
  }

  /**
   * Execute exit based on type (normal or emergency)
   * @param {string} type - 'normal' or 'emergency'
   * @param {Object} trade - Active trade
   * @param {Object} deltaPosition - Delta position
   * @param {Object} pi42Position - Pi42 position
   * @param {Object} reason - Reason (for emergency exits)
   * @returns {Promise<Object>} - Exit result
   */
  async executeExit(type, trade, deltaPosition, pi42Position, reason = null) {
    if (type === "normal") {
      return await this.executeNormalExit(trade, deltaPosition, pi42Position);
    } else {
      return await this.executeEmergencyExit(
        trade,
        deltaPosition,
        pi42Position,
        reason,
      );
    }
  }
}

export default new ExitManager();
