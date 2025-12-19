import deltaAPI from '../services/deltaAPI.js';
import pi42API from '../services/pi42API.js';
import config from '../config/config.js';

/**
 * Order Executor - Phase 3
 * Handles order execution on both Delta and Pi42 exchanges
 * with mandatory checks before placing orders
 */

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
class OrderExecutor {
  constructor() {
    this.primaryThreshold = config.trading.primaryThreshold;
    this.secondaryThreshold = config.trading.secondaryThreshold;
    this.leverage = config.trading.leverage;
    this.orderCooldownMinutes = config.trading.orderCooldownMinutes;

    // Track last successful order execution time
    this.lastExecutionTime = null;
  }

  /**
   * Check if we are in cooldown period
   * @returns {Object} - { inCooldown: boolean, remainingMinutes: number, message: string }
   */
  checkCooldown() {
    if (!this.lastExecutionTime) {
      return {
        inCooldown: false,
        remainingMinutes: 0,
        message: 'No previous executions'
      };
    }

    const now = Date.now();
    const timeSinceLastExecution = now - this.lastExecutionTime;
    const cooldownMs = this.orderCooldownMinutes * 60 * 1000;

    if (timeSinceLastExecution < cooldownMs) {
      const remainingMs = cooldownMs - timeSinceLastExecution;
      const remainingMinutes = Math.ceil(remainingMs / 60000);

      return {
        inCooldown: true,
        remainingMinutes,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        lastExecutionTime: new Date(this.lastExecutionTime).toLocaleString(),
        message: `Cooldown active: ${remainingMinutes} minute(s) remaining`
      };
    }

    return {
      inCooldown: false,
      remainingMinutes: 0,
      message: 'Cooldown period completed'
    };
  }

  /**
   * Re-check funding rate for a specific token before placing order
   * @param {Object} deltaData - Current Delta funding data
   * @param {Object} pi42Data - Current Pi42 funding data
   * @param {number} threshold - Threshold to check against
   * @returns {Object} - { passed: boolean, fundingDiff: number, reason: string }
   */
  recheckFundingRate(deltaData, pi42Data, threshold) {
    const FR_delta = deltaData.fundingRate;
    const FR_pi42 = pi42Data.fundingRate;

    // Validate funding rates exist
    if (FR_delta === null || FR_pi42 === null) {
      return {
        passed: false,
        fundingDiff: 0,
        reason: 'Missing funding rate data'
      };
    }

    // Calculate funding difference using the same logic as Phase 1
    const FR_first = Math.abs(FR_delta) >= Math.abs(FR_pi42) ? FR_delta : FR_pi42;
    const FR_second = Math.abs(FR_delta) >= Math.abs(FR_pi42) ? FR_pi42 : FR_delta;

    const fundingDiff = this.calculateFundingDifference(FR_first, FR_second);

    // Check if funding diff still exceeds threshold
    if (fundingDiff < threshold) {
      return {
        passed: false,
        fundingDiff,
        reason: `Funding differential ${fundingDiff.toFixed(4)}% is below threshold ${threshold}%`
      };
    }

    console.log(`✅ Funding rate re-check PASSED: ${fundingDiff.toFixed(4)}% >= ${threshold}%`);

    return {
      passed: true,
      fundingDiff,
      FR_delta,
      FR_pi42,
      FR_first,
      FR_second
    };
  }

  /**
   * Calculate funding rate difference (same logic as Phase 1)
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
   * Determine position sides based on common mapping
   * Common mapping:
   * - FR_first positive → SHORT on exchange_first, LONG on exchange_second
   * - FR_first negative → LONG on exchange_first, SHORT on exchange_second
   *
   * @param {number} FR_first - First funding rate
   * @param {string} exchange_first - First exchange ('delta' or 'pi42')
   * @param {string} exchange_second - Second exchange ('delta' or 'pi42')
   * @returns {Object} - { deltaSide, pi42Side, explanation }
   */
  determinePositionSides(FR_first, exchange_first, exchange_second) {
    let deltaSide, pi42Side;
    let explanation;

    if (FR_first > 0) {
      // FR_first is positive → SHORT on exchange_first, LONG on exchange_second
      if (exchange_first === 'delta') {
        deltaSide = 'SHORT'; // sell on Delta
        pi42Side = 'LONG';   // buy on Pi42
        explanation = `FR_first (${FR_first.toFixed(4)}%) is positive → SHORT on Delta, LONG on Pi42`;
      } else {
        deltaSide = 'LONG';  // buy on Delta
        pi42Side = 'SHORT';  // sell on Pi42
        explanation = `FR_first (${FR_first.toFixed(4)}%) is positive → LONG on Delta, SHORT on Pi42`;
      }
    } else {
      // FR_first is negative → LONG on exchange_first, SHORT on exchange_second
      if (exchange_first === 'delta') {
        deltaSide = 'LONG';  // buy on Delta
        pi42Side = 'SHORT';  // sell on Pi42
        explanation = `FR_first (${FR_first.toFixed(4)}%) is negative → LONG on Delta, SHORT on Pi42`;
      } else {
        deltaSide = 'SHORT'; // sell on Delta
        pi42Side = 'LONG';   // buy on Pi42
        explanation = `FR_first (${FR_first.toFixed(4)}%) is negative → SHORT on Delta, LONG on Pi42`;
      }
    }

    return { deltaSide, pi42Side, explanation };
  }

  /**
   * Place order on Delta Exchange
   * @param {string} symbol - Delta symbol (e.g., 'BTCUSD')
   * @param {string} side - 'LONG' or 'SHORT'
   * @param {number} quantity - Order quantity
   * @param {number} price - Limit price (optional, for limit orders)
   * @param {string} orderType - 'market_order' or 'limit_order'
   * @returns {Promise<Object>} - Order result
   */
  async placeOrderOnDelta(productId, symbol, side, quantity, price = null, orderType = 'market_order') {
    try {
      console.log(`\n📤 Placing order on Delta Exchange:`);
      console.log(`   Product ID: ${productId}`);
      console.log(`   Symbol: ${symbol}`);
      console.log(`   Side: ${side}`);
      console.log(`   Quantity: ${quantity}`);
      console.log(`   Type: ${orderType}`);
      if (price) console.log(`   Price: ${price}`);

      const deltaSide = side === 'LONG' ? 'buy' : 'sell';

      const orderParams = {
        productId: productId,      // Pass product ID
        symbol: symbol,            // For reference
        side: deltaSide,
        orderType: orderType,
        size: quantity,
        limitPrice: price,
        postOnly: false,
        reduceOnly: false
      };

      const result = await deltaAPI.placeOrder(orderParams);

      console.log(`✅ Delta order placed successfully:`, result);

      return {
        success: true,
        exchange: 'delta',
        orderId: result.id,
        symbol: symbol,
        side: side,
        quantity: quantity,
        result: result
      };

    } catch (error) {
      console.error(`❌ Failed to place order on Delta:`, error.message);
      return {
        success: false,
        exchange: 'delta',
        error: error.message
      };
    }
  }

  /**
   * Place order on Pi42 Exchange
   * @param {string} symbol - Pi42 symbol (e.g., 'BTCUSDT')
   * @param {string} side - 'LONG' or 'SHORT'
   * @param {number} quantity - Order quantity
   * @param {number} price - Limit price (optional, for limit orders)
   * @param {string} orderType - 'MARKET' or 'LIMIT'
   * @returns {Promise<Object>} - Order result
   */
  async placeOrderOnPi42(symbol, side, quantity, price = null, orderType = 'MARKET') {
    try {
      console.log(`\n📤 Placing order on Pi42 Exchange:`);
      console.log(`   Symbol: ${symbol}`);
      console.log(`   Side: ${side}`);
      console.log(`   Quantity: ${quantity}`);
      console.log(`   Type: ${orderType}`);
      if (price) console.log(`   Price: ${price}`);

      // Convert LONG/SHORT to BUY/SELL
      const pi42Side = side === 'LONG' ? 'BUY' : 'SELL';

      const orderParams = {
        symbol: symbol,
        side: pi42Side,
        orderType: orderType,
        quantity: quantity,
        price: price,
        timeInForce: 'GTC',
        postOnly: false,
        reduceOnly: false
      };

      const result = await pi42API.placeOrder(orderParams);

      console.log(`✅ Pi42 order placed successfully:`, result);

      return {
        success: true,
        exchange: 'pi42',
        orderId: result.orderId,
        symbol: symbol,
        side: side,
        quantity: quantity,
        result: result
      };

    } catch (error) {
      console.error(`❌ Failed to place order on Pi42:`, error.message);
      return {
        success: false,
        exchange: 'pi42',
        error: error.message
      };
    }
  }



  /**
   * Execute arbitrage trade on both exchanges
   * Mandatory checks:
   * 1. Re-check funding rate against threshold
   * 2. Determine position sides based on common mapping
   * 3. Place orders on both exchanges
   *
   * @param {Object} opportunity - Opportunity object from Phase 2
   * @param {Object} deltaFundingData - Current Delta funding data
   * @param {Object} pi42FundingData - Current Pi42 funding data
   * @returns {Promise<Object>} - Execution result
   */
  //  async executeArbitrageTrade(opportunity, deltaFundingData, pi42FundingData) {
  //   console.log("opportunity============", opportunity);
  //   console.log("opportunity.phase2.positionSize============", opportunity.phase2.positionSize.breakdown);
  //   console.log("deltaFundingData============", deltaFundingData);
  //   console.log("pi42FundingData============", pi42FundingData);
  //   console.log('\n' + '='.repeat(60));
  //   console.log('🎯 PHASE 3: ORDER EXECUTION');
  //   console.log('='.repeat(60));

  //   try {
  //     // Step 0: Set Leverage on Both Exchanges (Critical Prerequisite)
  //     console.log('\n⚙️ Step 0: Setting leverage on both exchanges...');

  //     // Delta Leverage
  //     const deltaProductId = await deltaAPI.getProductId(opportunity.token);
  //     if (!deltaProductId) {
  //       throw new Error(`Failed to retrieve product ID for Delta symbol: ${opportunity.token}`);
  //     } 

  //     console.log('Delta Product ID:', deltaProductId);

  //     await deltaAPI.setLeverage(deltaProductId, this.leverage);
  //     console.log(`   ✅ Delta leverage set to ${this.leverage}x`);


  //     const pi42Symbol = opportunity.pi42Symbol.replace(/USDT$/, 'INR');
  //     console.log('Pi42 Symbol for Leverage Setting:', pi42Symbol);
  //     // Pi42 Leverage + Margin Mode
  //     await pi42API.setLeverage(pi42Symbol, this.leverage);
  //     console.log(`   ✅ Pi42 leverage set to ${this.leverage}x (CROSS mode)`);


  //     console.log('⏳ Waiting 2 seconds for leverage updates to propagate...');
  //       await sleep(2000);
  //     // Step 1: Check Cooldown Period
  //     console.log('\n⏱️ Step 1: Checking cooldown period...');
  //     const cooldownCheck = this.checkCooldown();

  //     if (cooldownCheck.inCooldown) {
  //       console.log(`   ❌ ${cooldownCheck.message}`);
  //       console.log(`   Last execution: ${cooldownCheck.lastExecutionTime}`);
  //       console.log(`   Time remaining: ${cooldownCheck.remainingMinutes} minute(s) (${cooldownCheck.remainingSeconds} seconds)`);

  //       return {
  //         success: false,
  //         stage: 'cooldown_check',
  //         reason: cooldownCheck.message,
  //         cooldownInfo: cooldownCheck
  //       };
  //     }

  //     console.log(`   ✅ ${cooldownCheck.message} - Ready to execute`);

  //     // Step 2: Re-check Funding Rate
  //     console.log('\n📊 Step 2: Re-checking funding rate...');
  //     const fundingCheck = this.recheckFundingRate(
  //       deltaFundingData,
  //       pi42FundingData,
  //       opportunity.threshold
  //     );

  //     if (!fundingCheck.passed) {
  //       return {
  //         success: false,
  //         stage: 'funding_recheck',
  //         reason: fundingCheck.reason,
  //         fundingDiff: fundingCheck.fundingDiff
  //       };
  //     }

  //     console.log(`   ✅ Funding rate still valid: ${fundingCheck.fundingDiff.toFixed(4)}%`);
  //     console.log(`   Delta FR: ${fundingCheck.FR_delta.toFixed(4)}%`);
  //     console.log(`   Pi42 FR: ${fundingCheck.FR_pi42.toFixed(4)}%`);

  //     // Step 3: Determine Position Sides
  //     console.log('\n📊 Step 3: Determining position sides...');
  //     const exchange_first = Math.abs(fundingCheck.FR_delta) >= Math.abs(fundingCheck.FR_pi42) ? 'delta' : 'pi42';
  //     const exchange_second = exchange_first === 'delta' ? 'pi42' : 'delta';
  //     const FR_first = exchange_first === 'delta' ? fundingCheck.FR_delta : fundingCheck.FR_pi42;

  //     const positions = this.determinePositionSides(FR_first, exchange_first, exchange_second);

  //     console.log(`   ${positions.explanation}`);
  //     console.log(`   Delta Position: ${positions.deltaSide}`);
  //     console.log(`   Pi42 Position: ${positions.pi42Side}`);

  //     // Step 4: Extract Quantities and Prices from Phase 2
  //     const deltaQuantity = opportunity.phase2.positionSize.actualQuantity;
  //     const pi42Quantity = opportunity.phase2.positionSize.actualQuantity;

  //     const deltaPrice = opportunity.phase2.positionSize.breakdown.delta.tradingPrice;
  //     const pi42Price = opportunity.phase2.positionSize.breakdown.pi42.tradingPrice;

  //     console.log(`\n📊 Step 4: Preparing orders...`);
  //     console.log(`   Delta: ${positions.deltaSide} ${deltaQuantity} contracts @ ${deltaPrice}`);
  //     console.log(`   Pi42: ${positions.pi42Side} ${pi42Quantity} @ ${pi42Price}`);

  //     // Step 5: Place Orders Simultaneously
  //     console.log('\n🚀 Step 5: Executing orders on both exchanges...');
  //     const [deltaOrder, pi42Order] = await Promise.all([
  //       this.placeOrderOnDelta(
  //        deltaProductId,          // Pass product ID
  //           opportunity.token,       // Symbol
  //           positions.deltaSide,
  //           deltaQuantity,
  //           deltaPrice,
  //           'limit_order'
  //       ),
  //       this.placeOrderOnPi42(
  //         pi42Symbol,
  //         positions.pi42Side,
  //         pi42Quantity,
  //         pi42Price,
  //         'LIMIT'
  //       )
  //     ]);

  //     // Final Check: Both Orders Successful?
  //     if (!deltaOrder.success || !pi42Order.success) {
  //       console.error('\n❌ One or more orders failed:');
  //       if (!deltaOrder.success) console.error(`   Delta Error: ${deltaOrder.error}`);
  //       if (!pi42Order.success) console.error(`   Pi42 Error: ${pi42Order.error}`);

  //       return {
  //         success: false,
  //         stage: 'order_placement',
  //         deltaOrder,
  //         pi42Order,
  //         reason: 'One or more orders failed to execute'
  //       };
  //     }

  //     // Success!
  //     console.log('\n✅ Arbitrage trade executed successfully on both exchanges!');

  //     // Activate Cooldown
  //     this.lastExecutionTime = Date.now();
  //     const nextAvailableTime = new Date(this.lastExecutionTime + (this.orderCooldownMinutes * 60 * 1000));

  //     console.log(`⏱️  Cooldown activated: ${this.orderCooldownMinutes} minutes`);
  //     console.log(`   Next execution available at: ${nextAvailableTime.toLocaleString()}`);
  //     console.log('='.repeat(60));

  //     return {
  //       success: true,
  //       deltaOrder,
  //       pi42Order,
  //       positions,
  //       fundingCheck,
  //       executionTime: new Date().toISOString(),
  //       cooldownInfo: {
  //         cooldownMinutes: this.orderCooldownMinutes,
  //         nextAvailableTime: nextAvailableTime.toISOString()
  //       }
  //     };

  //   } catch (error) {
  //     console.error('\n❌ Phase 3 execution failed:', error.message);
  //     console.error(error.stack);

  //     return {
  //       success: false,
  //       stage: 'execution_error',
  //       error: error.message,
  //       stack: error.stack
  //     };
  //   }
  // }


  async executeArbitrageTrade(opportunity, deltaFundingData, pi42FundingData) {
    console.log("opportunity============", opportunity);
    console.log("opportunity.phase2.positionSize============", opportunity.phase2.positionSize.breakdown);
    console.log("deltaFundingData============", deltaFundingData);
    console.log("pi42FundingData============", pi42FundingData);
    console.log('\n' + '='.repeat(60));
    console.log('🎯 PHASE 3: ORDER EXECUTION');
    console.log('='.repeat(60));

    let size;
    let pi42RealQuantity;

    try {
      // Step 0: Set Leverage on Both Exchanges (Critical Prerequisite)
      console.log('\n⚙️ Step 0: Setting leverage on both exchanges...');

      // Get Delta Product ID
      const deltaProductId = await deltaAPI.getProductId(opportunity.token);

      console.log('Delta Product ID:', deltaProductId);
      if (!deltaProductId) {
        throw new Error(`Failed to retrieve product ID for Delta symbol: ${opportunity.token}`);
      }
      console.log('Delta Product ID:', deltaProductId);

      // Determine correct Pi42 symbol - use the one from the opportunity
      const pi42Symbol = opportunity.pi42Symbol; // Use original MOVEUSDT, not MOVEINR
      console.log('Pi42 Symbol for Leverage Setting:', pi42Symbol);

      // Set leverage on BOTH exchanges and WAIT for completion
      try {
        await deltaAPI.setLeverage(deltaProductId, this.leverage);
        console.log(`   ✅ Delta leverage set to ${this.leverage}x`);
      } catch (error) {
        console.error(`   ⚠️ Delta leverage setting failed: ${error.message}`);
        // Continue anyway - leverage might already be set
      }

      try {
        await pi42API.setLeverage(pi42Symbol, this.leverage);
        console.log(`   ✅ Pi42 leverage set to ${this.leverage}x (CROSS mode)`);
      } catch (error) {
        console.error(`   ⚠️ Pi42 leverage setting failed: ${error.message}`);
        // Continue anyway - leverage might already be set
      }
      try {
        console.log('🔍 Fetching Delta lot size for token:', opportunity.token);

        const lotInfo = await deltaAPI.getLotSize(opportunity.token);
        const contractValue = Number(lotInfo.contractValue);

        if (!contractValue || contractValue <= 0) {
          throw new Error(`Invalid contract value received: ${contractValue}`);
        }

        console.log('✅ Lot size found:', lotInfo);

        // 1️⃣ Convert real quantity → Delta contracts
        const actualQuantity = Number(opportunity.phase2.positionSize.actualQuantity);

        let deltaContracts = Math.floor(actualQuantity / contractValue);


        if (deltaContracts <= 0) {
          throw new Error(
            `Delta order size is zero. actualQuantity=${actualQuantity}, contractValue=${contractValue}`
          );
        }
        size = deltaContracts;
        console.log(`✅ Calculated Delta order size: ${deltaContracts} contracts`);

        // 2️⃣ Convert Delta contracts → Pi42 quantity
        const pi42Quantity = deltaContracts * contractValue;

        console.log(`✅ Calculated Pi42 order quantity: ${pi42Quantity} units`);

        // 3️⃣ Sanity check (Delta ↔ Pi42 consistency)
        if (pi42Quantity / contractValue !== deltaContracts) {
          throw new Error(
            `Quantity mismatch detected. Delta=${deltaContracts}, Pi42=${pi42Quantity}`
          );

        }

        pi42RealQuantity = pi42Quantity;

      } catch (error) {
        console.error(`   ⚠️ Pi42 leverage setting failed: ${error.message}`);
        // Continue anyway - leverage might already be set
      }
      // CRITICAL: Wait for leverage to propagate
      console.log('⏳ Waiting 2 seconds for leverage updates to propagate...');
      // await new Promise(resolve => setTimeout(resolve, 5000));

      // Step 1: Check Cooldown Period
      console.log('\n⏱️ Step 1: Checking cooldown period...');
      const cooldownCheck = this.checkCooldown();

      if (cooldownCheck.inCooldown) {
        console.log(`   ❌ ${cooldownCheck.message}`);
        console.log(`   Last execution: ${cooldownCheck.lastExecutionTime}`);
        console.log(`   Time remaining: ${cooldownCheck.remainingMinutes} minute(s) (${cooldownCheck.remainingSeconds} seconds)`);

        return {
          success: false,
          stage: 'cooldown_check',
          reason: cooldownCheck.message,
          cooldownInfo: cooldownCheck
        };
      }

      console.log(`   ✅ ${cooldownCheck.message} - Ready to execute`);

      // Step 2: Re-check Funding Rate
      console.log('\n📊 Step 2: Re-checking funding rate...');
      const fundingCheck = this.recheckFundingRate(
        deltaFundingData,
        pi42FundingData,
        opportunity.threshold
      );

      if (!fundingCheck.passed) {
        return {
          success: false,
          stage: 'funding_recheck',
          reason: fundingCheck.reason,
          fundingDiff: fundingCheck.fundingDiff
        };
      }

      console.log(`   ✅ Funding rate still valid: ${fundingCheck.fundingDiff.toFixed(4)}%`);
      console.log(`   Delta FR: ${fundingCheck.FR_delta.toFixed(4)}%`);
      console.log(`   Pi42 FR: ${fundingCheck.FR_pi42.toFixed(4)}%`);

      // Step 3: Determine Position Sides
      console.log('\n📊 Step 3: Determining position sides...');
      const exchange_first = Math.abs(fundingCheck.FR_delta) >= Math.abs(fundingCheck.FR_pi42) ? 'delta' : 'pi42';
      const exchange_second = exchange_first === 'delta' ? 'pi42' : 'delta';
      const FR_first = exchange_first === 'delta' ? fundingCheck.FR_delta : fundingCheck.FR_pi42;

      const positions = this.determinePositionSides(FR_first, exchange_first, exchange_second);

      console.log(`   ${positions.explanation}`);
      console.log(`   Delta Position: ${positions.deltaSide}`);
      console.log(`   Pi42 Position: ${positions.pi42Side}`);

      // Step 4: Extract Quantities and Prices from Phase 2
      const deltaQuantity = opportunity.phase2.positionSize.actualQuantity;
      const pi42Quantity = opportunity.phase2.positionSize.actualQuantity;

      const deltaPrice = opportunity.phase2.positionSize.breakdown.delta.tradingPrice;
      const pi42Price = opportunity.phase2.positionSize.breakdown.pi42.tradingPrice;

      console.log(`\n📊 Step 4: Preparing orders...`);
      console.log(`   Delta: ${positions.deltaSide} ${deltaQuantity} contracts @ ${deltaPrice}`);
      console.log(`   Pi42: ${positions.pi42Side} ${pi42Quantity} @ ${pi42Price}`);

      try {
        console.log('  Setting to find the lotsize.......', opportunity.deltaSymbol);
        await deltaAPI.getLotSize(opportunity.deltaSymbol);
        console.log(`   ✅ Delta leverage set to ${this.leverage}x before order placement`);
      } catch (error) {
        console.error(`   ⚠️ Pi42 leverage setting failed: ${error.message}`);
        // Continue anyway - leverage might already be set
      }

      // Step 5: Place Orders Simultaneously
      console.log('\n🚀 Step 5: Executing orders on both exchanges...');

      const [deltaOrder, pi42Order] = await Promise.all([
        this.placeOrderOnDelta(
          deltaProductId,
          opportunity.token,
          positions.deltaSide,
          size,
          deltaPrice,
          'limit_order'
        ),
        this.placeOrderOnPi42(
          pi42Symbol, // Use original symbol, not converted
          positions.pi42Side,
          pi42RealQuantity,
          pi42Price,
          'LIMIT'
        )
      ]);

      // Final Check: Both Orders Successful?
      if (!deltaOrder.success || !pi42Order.success) {
        console.error('\n❌ One or more orders failed:');
        if (!deltaOrder.success) console.error(`   Delta Error: ${deltaOrder.error}`);
        if (!pi42Order.success) console.error(`   Pi42 Error: ${pi42Order.error}`);

        console.log(`\n❌ PHASE 3: Execution failed at order_placement`);
        console.log(`   Reason: One or more orders failed to execute`);

        return {
          success: false,
          stage: 'order_placement',
          deltaOrder,
          pi42Order,
          reason: 'One or more orders failed to execute'
        };
      }

      // Success!
      console.log('\n✅ Arbitrage trade executed successfully on both exchanges!');

      // Activate Cooldown
      this.lastExecutionTime = Date.now();
      const nextAvailableTime = new Date(this.lastExecutionTime + (this.orderCooldownMinutes * 60 * 1000));

      console.log(`⏱️  Cooldown activated: ${this.orderCooldownMinutes} minutes`);
      console.log(`   Next execution available at: ${nextAvailableTime.toLocaleString()}`);
      console.log('='.repeat(60));

      return {
        success: true,
        deltaOrder,
        pi42Order,
        positions,
        fundingCheck,
        executionTime: new Date().toISOString(),
        cooldownInfo: {
          cooldownMinutes: this.orderCooldownMinutes,
          nextAvailableTime: nextAvailableTime.toISOString()
        }
      };

    } catch (error) {
      console.error('\n❌ Phase 3 execution failed:', error.message);
      console.error(error.stack);

      return {
        success: false,
        stage: 'execution_error',
        error: error.message,
        stack: error.stack
      };
    }
  }
}

export default new OrderExecutor();
