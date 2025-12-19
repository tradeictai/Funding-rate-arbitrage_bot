import deltaAPI from '../services/deltaAPI.js';
import pi42API from '../services/pi42API.js';
import config from '../config/config.js';
import mongoService from '../services/mongoService.js';

/**
 * Exit Manager - Phase 5
 * Handles both normal exits (after funding) and emergency exits
 */
class ExitManager {
  constructor() {
    this.maxWaitForFunding = config.trading.maxWaitForFundingSeconds * 1000; // Convert to ms
    this.pollInterval = config.trading.pollIntervalSeconds * 1000; // Convert to ms
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
        timestamp: Date.now()
      };

    } catch (error) {
      console.error('Error checking Delta funding credit:', error.message);
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
        timestamp: Date.now()
      };

    } catch (error) {
      console.error('Error checking Pi42 funding credit:', error.message);
      return { credited: false, amount: 0 };
    }
  }

  /**
   * Wait for funding credit with timeout
   * @param {Object} trade - Active trade object
   * @returns {Promise<Object>} - { success: boolean, deltaCredit: Object, pi42Credit: Object }
   */
  async waitForFundingCredit(trade) {
    console.log('\n⏳ WAITING FOR FUNDING CREDIT');
    console.log('='.repeat(60));
    console.log(`Max wait time: ${this.maxWaitForFunding / 1000}s`);
    console.log(`Poll interval: ${this.pollInterval / 1000}s`);
    console.log('='.repeat(60));

    const startTime = Date.now();
    const endTime = startTime + this.maxWaitForFunding;

    while (Date.now() < endTime) {
      // Check both exchanges for funding credit
      const [deltaCredit, pi42Credit] = await Promise.all([
        this.checkDeltaFundingCredit(trade.deltaSymbol, startTime),
        this.checkPi42FundingCredit(trade.pi42Symbol, startTime)
      ]);

      console.log('\n📊 Funding Credit Check:');
      console.log(`   Delta: ${deltaCredit.credited ? '✅ Credited' : '⏳ Waiting...'}`);
      console.log(`   Pi42:  ${pi42Credit.credited ? '✅ Credited' : '⏳ Waiting...'}`);

      // If both credited, return success
      if (deltaCredit.credited && pi42Credit.credited) {
        console.log('\n✅ FUNDING CREDITED ON BOTH EXCHANGES');
        console.log('='.repeat(60));
        return {
          success: true,
          deltaCredit,
          pi42Credit
        };
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, this.pollInterval));

      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = (endTime - Date.now()) / 1000;
      console.log(`   Elapsed: ${elapsed.toFixed(0)}s | Remaining: ${remaining.toFixed(0)}s`);
    }

    // Timeout reached
    console.log('\n⚠️  TIMEOUT: Max wait time reached without funding credit');
    console.log('='.repeat(60));

    return {
      success: false,
      reason: 'Timeout waiting for funding credit',
      elapsed: (Date.now() - startTime) / 1000
    };
  }

  /**
   * Execute limit exit on Delta
   * @param {Object} position - Position to close
   * @param {number} exitPrice - Exit price
   * @returns {Promise<Object>} - Exit order result
   */
  async exitDeltaPosition(position, exitPrice = null) {
    try {
      console.log("Existing Delta Position:", position);
      // console.log(`\n📤 Exiting Delta position: ${position.product_symbol}`);

      const size = Math.abs(position.details.deltaPosition.size);
      const side = position.details.deltaPosition.side  === 'LONG' ? 'sell' : 'buy'; // Opposite side to close

      // Use market order if no exit price specified
      const orderType = exitPrice ? 'limit_order' : 'market_order';

      const orderParams = {
        productId: position.details.deltaPosition.product_id,
        symbol: position.details.deltaPosition.product_symbol,
        side: side,
        orderType: orderType,
        size: size,
        limitPrice: exitPrice,
        postOnly: false,
        reduceOnly: true // Important: reduce only to close position
      };

      console.log('   Order type:', orderType);
      console.log('   Side:', side);
      console.log('   Size:', size);
      if (exitPrice) console.log('   Exit price:', exitPrice);

      const result = await deltaAPI.placeOrder(orderParams);

      console.log('✅ Delta exit order placed successfully');

      return {
        success: true,
        exchange: 'delta',
        orderId: result.id,
        symbol: position.details.deltaPosition.product_symbol,
        side: side,
        size: size,
        orderType: orderType,
        exitPrice: exitPrice,
        result: result
      };

    } catch (error) {
      console.error(`❌ Failed to exit Delta position:`, error.message);
      return {
        success: false,
        exchange: 'delta',
        error: error.message
      };
    }
  }

  /**
   * Execute limit exit on Pi42
   * @param {Object} position - Position to close
   * @param {number} exitPrice - Exit price
   * @returns {Promise<Object>} - Exit order result
   */
  async exitPi42Position(position, exitPrice = null) {
    try {
      console.log("Existing Delta Position:", position);
      console.log(`\n📤 Exiting Pi42 position: ${position.details.pi42Position.contractPair}`);

      const size = Math.abs(position.details.pi42Position.quantity);
      const side = position.details.pi42Position.positionType ===  'SHORT' ? 'BUY' : 'SELL'; // Opposite side to close

      // Use market order if no exit price specified
      const orderType = exitPrice ? 'LIMIT' : 'MARKET';

      const orderParams = {
        symbol: position.details.pi42Position.contractPair,
        side: side,
        orderType: orderType,
        quantity: size,
        price: exitPrice,
        reduceOnly: true, // Important: reduce only to close position
        positionId: position.details.pi42Position.positionId
      };

      console.log('   Order type:', orderType);
      console.log('   Side:', side);
      console.log('   Quantity:', size);
      if (exitPrice) console.log('   Exit price:', exitPrice);

      const result = await pi42API.placeOrder(orderParams);

      console.log('✅ Pi42 exit order placed successfully');

      return {
        success: true,
        exchange: 'pi42',
        orderId: result.orderId || result.clientOrderId,
        symbol: position.symbol,
        side: side,
        quantity: size,
        orderType: orderType,
        exitPrice: exitPrice,
        result: result
      };

    } catch (error) {
      console.error(`❌ Failed to exit Pi42 position:`, error.message);
      return {
        success: false,
        exchange: 'pi42',
        error: error.message
      };
    }
  }

  /**
   * Normal exit after funding credit (limit orders)
   * @param {Object} trade - Active trade object
   * @param {Object} deltaPosition - Delta position
   * @param {Object} pi42Position - Pi42 position
   * @returns {Promise<Object>} - Exit result
   */
  async executeNormalExit(trade, deltaPosition, pi42Position) {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 EXECUTING NORMAL EXIT (POST-FUNDING)');
    console.log('='.repeat(60));

    try {
      // Wait for funding credit
      const fundingResult = await this.waitForFundingCredit(trade);

      if (!fundingResult.success) {
        console.log('⚠️  Funding not credited within timeout');
        console.log('   Switching to immediate market exit for safety');

        // Fall back to emergency exit
        return await this.executeEmergencyExit(trade, deltaPosition, pi42Position, {
          reason: 'Funding credit timeout',
          details: fundingResult
        });
      }

      // Funding credited, proceed with limit exits
      console.log('\n📊 Executing limit exits on both exchanges...');

      // Calculate exit prices (could use current market price or a slight improvement)
      const deltaExitPrice = deltaPosition.mark_price; // Could add spread for better execution
      const pi42ExitPrice = pi42Position.markPrice;

      // Place exit orders on both exchanges
      const [deltaExit, pi42Exit] = await Promise.all([
        this.exitDeltaPosition(deltaPosition, deltaExitPrice),
        this.exitPi42Position(pi42Position, pi42ExitPrice)
      ]);

      // Check results
      if (!deltaExit.success || !pi42Exit.success) {
        console.error('\n❌ One or more exit orders failed:');
        if (!deltaExit.success) console.error(`   Delta: ${deltaExit.error}`);
        if (!pi42Exit.success) console.error(`   Pi42: ${pi42Exit.error}`);

        return {
          success: false,
          stage: 'exit_orders',
          deltaExit,
          pi42Exit,
          reason: 'One or more exit orders failed'
        };
      }

      console.log('\n✅ NORMAL EXIT COMPLETED SUCCESSFULLY');
      console.log('='.repeat(60));

      // Store exit result
      const exitResult = {
        success: true,
        type: 'normal_exit',
        deltaExit,
        pi42Exit,
        fundingCredit: fundingResult,
        exitTime: new Date().toISOString()
      };

      // Persist to MongoDB
      await mongoService.storeExitResult(exitResult);

      return exitResult;

    } catch (error) {
      console.error('\n❌ Normal exit failed:', error.message);

      // Fall back to emergency exit
      return await this.executeEmergencyExit(trade, deltaPosition, pi42Position, {
        reason: 'Normal exit error',
        error: error.message
      });
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
    console.log('\n' + '🚨'.repeat(30));
    console.log('🚨 EXECUTING EMERGENCY EXIT 🚨');
    console.log('🚨'.repeat(30));
    console.log('Reason:', reason.reason);
    console.log('Details:', JSON.stringify(reason.details || {}, null, 2));
    console.log('='.repeat(60));

    try {
      console.log('\n📊 Placing MARKET orders to close both positions...');

      // Place market orders on both exchanges (no price, immediate execution)
      const [deltaExit, pi42Exit] = await Promise.all([
        this.exitDeltaPosition(trade, trade.deltaPosition), // null = market order
        this.exitPi42Position(trade, trade.pi42Position)    // null = market order
      ]);

      // Check results
      if (!deltaExit.success || !pi42Exit.success) {
        console.error('\n❌ CRITICAL: One or more emergency exit orders failed:');
        if (!deltaExit.success) console.error(`   Delta: ${deltaExit.error}`);
        if (!pi42Exit.success) console.error(`   Pi42: ${pi42Exit.error}`);

        return {
          success: false,
          type: 'emergency_exit',
          stage: 'exit_orders',
          deltaExit,
          pi42Exit,
          reason: reason.reason,
          details: reason.details
        };
      }

      console.log('\n✅ EMERGENCY EXIT COMPLETED');
      console.log('='.repeat(60));

      // Store exit result
      const exitResult = {
        success: true,
        type: 'emergency_exit',
        deltaExit,
        pi42Exit,
        reason: reason.reason,
        details: reason.details,
        exitTime: new Date().toISOString()
      };

      // Persist to MongoDB
      await mongoService.storeExitResult(exitResult);

      return exitResult;

    } catch (error) {
      console.error('\n❌ CRITICAL: Emergency exit failed:', error.message);
      console.error(error.stack);

      return {
        success: false,
        type: 'emergency_exit',
        stage: 'critical_error',
        error: error.message,
        reason: reason.reason,
        details: reason.details
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
    if (type === 'normal') {
      return await this.executeNormalExit(trade, deltaPosition, pi42Position);
    } else {
      return await this.executeEmergencyExit(trade, deltaPosition, pi42Position, reason);
    }
  }
}

export default new ExitManager();
