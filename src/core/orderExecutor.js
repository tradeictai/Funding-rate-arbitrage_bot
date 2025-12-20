import deltaAPI from '../services/deltaAPI.js';
import pi42API from '../services/pi42API.js';
import config from '../config/config.js';
import coindcxAPI from '../services/coindcxAPI.js';

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
  recheckFundingRate(deltaData, coindcxData, threshold) {
    const FR_delta = deltaData.fundingRate;
    const FR_coindcx = coindcxData.fundingRate;

    // Validate funding rates exist
    if (FR_delta === null || FR_coindcx === null) {
      return {
        passed: false,
        fundingDiff: 0,
        reason: 'Missing funding rate data'
      };
    }

    // Calculate funding difference using the same logic as Phase 1
    const FR_first = Math.abs(FR_delta) >= Math.abs(FR_coindcx) ? FR_delta : FR_coindcx;
    const FR_second = Math.abs(FR_delta) >= Math.abs(FR_coindcx) ? FR_coindcx : FR_delta;

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
      FR_coindcx,
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
    let deltaSide, coindcxSide;
    let explanation;

    if (FR_first > 0) {
      // FR_first is positive → SHORT on exchange_first, LONG on exchange_second
      if (exchange_first === 'delta') {
        deltaSide = 'SHORT'; // sell on Delta
        coindcxSide = 'LONG';   // buy on Pi42
        explanation = `FR_first (${FR_first.toFixed(4)}%) is positive → SHORT on Delta, LONG on Pi42`;
      } else {
        deltaSide = 'LONG';  // buy on Delta
        coindcxSide = 'SHORT';  // sell on Pi42
        explanation = `FR_first (${FR_first.toFixed(4)}%) is positive → LONG on Delta, SHORT on Pi42`;
      }
    } else {
      // FR_first is negative → LONG on exchange_first, SHORT on exchange_second
      if (exchange_first === 'delta') {
        deltaSide = 'LONG';  // buy on Delta
        coindcxSide = 'SHORT';  // sell on Pi42
        explanation = `FR_first (${FR_first.toFixed(4)}%) is negative → LONG on Delta, SHORT on Pi42`;
      } else {
        deltaSide = 'SHORT'; // sell on Delta
        coindcxSide = 'LONG';   // buy on Pi42
        explanation = `FR_first (${FR_first.toFixed(4)}%) is negative → SHORT on Delta, LONG on Pi42`;
      }
    }

    return { deltaSide, coindcxSide, explanation };
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
 async placeOrderOnCoinDCX(symbol, side, quantity, price = null, orderType = 'MARKET') {
  try {
    console.log(`\n📤 Placing order on CoinDCX Futures:`);
    console.log(`   Symbol: ${symbol}`);
    console.log(`   Side: ${side}`);
    console.log(`   Quantity: ${quantity}`);
    console.log(`   Type: ${orderType}`);
    if (price) console.log(`   Price: ${price}`);
    const apiSide = side.toUpperCase() === 'LONG' ? 'buy' : 'sell';
    const orderObj = {
      pair: symbol, // e.g., "B-BTC_USDT"
      side: apiSide, // "buy" or "sell"
      order_type: orderType.toLowerCase() === 'limit' ? 'limit_order' : 'market_order',
      total_quantity: Number(quantity)
    };

    if (orderType.toLowerCase() === 'limit') {
      const roundedPrice = Math.round(Number(price) * 1000000) / 1000000;
      orderObj.price = roundedPrice;
      orderObj.time_in_force = 'good_till_cancel'; // Optional but safe
    }

    // Optional: leverage (recommended to match position)
    if (this.leverage) {
      orderObj.leverage = Number(this.leverage);
    }

    // Default safe values
    orderObj.notification = 'no_notification';
    orderObj.position_margin_type = 'crossed'; // or 'isolated'
    orderObj.margin_currency_short_name = 'USDT'; // or 'INR'

    const body = { order: orderObj };

    console.log('CoinDCX Order Payload:', body);

    const result = await coindcxAPI.placeOrder(body);

    console.log(`✅ CoinDCX order placed successfully:`, result);

    return {
      success: true,
      exchange: 'coindcx',
      orderId: result[0]?.id || result.id,
      symbol: symbol,
      side: side,
      quantity: quantity,
      result: result
    };
  } catch (error) {
    console.error(`❌ Failed to place order on CoinDCX:`, error.message);
    return {
      success: false,
      exchange: 'coindcx',
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


  async executeArbitrageTrade(opportunity, deltaFundingData, coindcxFundingData) {
  console.log("opportunity============", opportunity);
  console.log("deltaFundingData============", deltaFundingData);
  console.log("coindcxFundingData============", coindcxFundingData);
  console.log('\n' + '='.repeat(60));
  console.log('🎯 PHASE 3: ORDER EXECUTION (Delta + CoinDCX)');
  console.log('='.repeat(60));

  let size;
  let coindcxRealQuantity;

  try {
    // Step 0: Set Leverage on Both Exchanges
    console.log('\n⚙️ Step 0: Setting leverage on both exchanges...');

    const deltaProductId = await deltaAPI.getProductId(opportunity.token);
    if (!deltaProductId) throw new Error(`Failed to get Delta product ID for ${opportunity.token}`);

    const coindcxSymbol = opportunity.phase2.positionSize.coindcxSymbol || `B-${opportunity.token}_USDT`; // e.g., B-BTC_USDT
    console.log('CoinDCX Symbol:', coindcxSymbol);

    // Set leverage
    try {
      await deltaAPI.setLeverage(deltaProductId, this.leverage);
      console.log(`   ✅ Delta leverage set to ${this.leverage}x`);
    } catch (e) {
      console.warn(`   ⚠️ Delta leverage failed (continuing): ${e.message}`);
    }

    // CoinDCX doesn't have REST setLeverage — it uses order.leverage field
    console.log(`   ℹ️ CoinDCX leverage will be set via order parameter (${this.leverage}x)`);

    // Step 1: Calculate Order Sizes
    console.log('\n📏 Step 1: Calculating position sizes...');

    const lotInfo = await deltaAPI.getLotSize(opportunity.token);
    const contractValue = Number(lotInfo.contractValue);
    if (!contractValue || contractValue <= 0) throw new Error('Invalid contract value');

    const actualQuantity = Number(opportunity.phase2.positionSize.actualQuantity);
    let deltaContracts = Math.floor(actualQuantity / contractValue);

    if (deltaContracts <= 0) {
      throw new Error(`Delta order size too small: ${actualQuantity} / ${contractValue}`);
    }

    size = deltaContracts;
    coindcxRealQuantity = deltaContracts * contractValue; // Same notional on CoinDCX

    console.log(`✅ Delta: ${deltaContracts} contracts`);
    console.log(`✅ CoinDCX: ${coindcxRealQuantity} units`);

    // Step 2: Cooldown Check
    console.log('\n⏱️ Step 2: Checking cooldown...');
    const cooldownCheck = this.checkCooldown();
    if (cooldownCheck.inCooldown) {
      return { success: false, stage: 'cooldown', cooldownInfo: cooldownCheck };
    }

    // Step 3: Re-check Funding Rate
    console.log('\n📊 Step 3: Re-checking funding rate...');
    const fundingCheck = this.recheckFundingRate(
      deltaFundingData,
      coindcxFundingData,
      opportunity.threshold
    );
    
    console.log("fndfasfdsa", fundingCheck)
    if (!fundingCheck.passed) {
      return { success: false, stage: 'funding_recheck', reason: fundingCheck.reason };
    }

    // Step 4: Determine Sides
    console.log('\n📊 Step 4: Determining position sides...');
    const exchange_first = Math.abs(fundingCheck.FR_delta) >= Math.abs(fundingCheck.FR_coindcx) ? 'delta' : 'coindcx';
    const FR_first = exchange_first === 'delta' ? fundingCheck.FR_delta : fundingCheck.FR_coindcx;

    const positions = this.determinePositionSides(FR_first, exchange_first, exchange_first === 'delta' ? 'coindcx' : 'delta');

    console.log(`   ${positions.explanation}`);
    console.log(`   Delta: ${positions.deltaSide}`);
    console.log(`   CoinDCX: ${positions.coindcxSide}`);

    // Step 5: Get Prices
    const deltaPrice = opportunity.phase2.positionSize.breakdown.delta.tradingPrice;
    const coindcxPrice = opportunity.phase2.positionSize.breakdown.coindcx?.tradingPrice || deltaPrice;

    console.log(`\n🚀 Step 5: Placing orders...`);
    console.log(`   Delta: ${positions.deltaSide} ${size} @ ${deltaPrice}`);
    console.log(`   CoinDCX: ${positions.coindcxSide} ${coindcxRealQuantity} @ ${coindcxPrice}`);

    // Step 6: Execute Orders Simultaneously
    const [deltaOrder, coindcxOrder] = await Promise.all([
      this.placeOrderOnDelta(
        deltaProductId,
        opportunity.token,
        positions.deltaSide,
        size,
        deltaPrice,
        'limit_order'
      ),
      this.placeOrderOnCoinDCX(
        coindcxSymbol,
        positions.coindcxSide,
        coindcxRealQuantity,
        coindcxPrice,
        'LIMIT'
      )
    ]);

    if (!deltaOrder.success || !coindcxOrder.success) {
      console.error('❌ One or both orders failed');
      return {
        success: false,
        stage: 'order_placement',
        deltaOrder,
        coindcxOrder
      };
    }

    // Success!
    this.lastExecutionTime = Date.now();
    const nextTime = new Date(this.lastExecutionTime + this.orderCooldownMinutes * 60 * 1000);

    console.log('\n✅ Arbitrage executed successfully on Delta + CoinDCX!');
    console.log(`⏱️ Cooldown: ${this.orderCooldownMinutes} minutes`);
    console.log(`   Next trade: ${nextTime.toLocaleString()}`);

    return {
      success: true,
      deltaOrder,
      coindcxOrder,
      positions,
      fundingCheck,
      executionTime: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Execution failed:', error.message);
    return {
      success: false,
      stage: 'execution_error',
      error: error.message
    };
  }
}
}

export default new OrderExecutor();
