import EventEmitter from 'events';
import DeltaPositionMonitor from './deltaPositionMonitor.js';
import Pi42PositionMonitor from './pi42PositionMonitor.js';
import config from '../config/config.js';
import CoinDCXPositionMonitor from './coindcxPositionMonitor.js';

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

    this.quantityTolerance = config.trading.quantityTolerance || 0.05; // 5%
    this.minProfitThreshold = config.trading.minProfitThreshold || 0.001; // e.g. 0.01%

    this.flipCheckTimer = null;

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Delta Events
    this.deltaMonitor.on('position', (data) => {
      console.log('Delta position event received:', data);
      this.handleDeltaPosition(data);
    });

    this.deltaMonitor.on('snapshot', (data) => {
      console.log(`📊 Delta snapshot: ${data.count} position(s)`);
    });

    // Pi42 Events
    this.coindcxMonitor.on('position', (data) => {

      console.log('Coindcx position event received:', data);
      this.handleCoindcxPosition(data);
    });

    // Listen to funding rate updates for real-time flip detection
    this.deltaMonitor.on('funding_rate', () => {
      if (this.latestDeltaPosition && this.latestCoindcxPosition) {
        this.checkForNormalExit();
        this.performFlipCheck();
        
      }
    });

    this.coindcxMonitor.on('funding_rate', () => {
      if (this.latestDeltaPosition && this.latestCoindcxPosition) {
        this.checkForNormalExit();
        this.performFlipCheck();
        
      }
    });
  }

  async handleDeltaPosition(data) {
    const { type, position } = data;

    console.log(`\n🔔 Delta Position Event: ${type.toUpperCase()}`);
    console.log(`   Symbol: ${position.product_symbol} | Size: ${Math.abs(position.size || 0)}`);

    this.latestDeltaPosition = position;

    if (this.latestCoindcxPosition ) {
      
      await this.performQuantityCheck(this.latestDeltaPosition, this.latestCoindcxPosition);
      this.performFlipCheck();
       this.checkForNormalExit();          // Check flip on every Delta update
      // Check if funding time completed
    }
  }

  async handleCoindcxPosition(data) {
    const { type, position } = data;

    console.log(`\n🔔 Coindcx Position Event: ${type.toUpperCase()}`);
    console.log(`   Symbol: ${position.symbol || position.contractPair} | Amount: ${Math.abs(position.positionAmount || 0)}`);

    this.latestCoindcxPosition = position;

    if (this.latestDeltaPosition) {
      await this.performQuantityCheck(this.latestDeltaPosition, this.latestCoindcxPosition);
      this.performFlipCheck();           // Check flip on every Pi42 update
      this.checkForNormalExit();         // Check if funding time completed
    }
  }

  async performQuantityCheck(deltaPosition, coindcxPosition) {
    if (!deltaPosition || !coindcxPosition) return;

    const deltaSize = Math.abs(deltaPosition.size || 0);
    const deltaContractValue = parseFloat(deltaPosition.product?.contract_value || 1);
    const deltaQuantity = deltaSize * deltaContractValue;
    const coindcxQuantity = Math.abs(coindcxPosition.positionAmount || 0);

    console.log('\n🔍 QUANTITY CHECK');
    console.log('='.repeat(60));
    console.log(`Delta: ${deltaQuantity.toFixed(4)} (${deltaSize} × ${deltaContractValue})`);
    console.log(`Pi42:  ${coindcxQuantity.toFixed(4)}`);

    const maxQty = Math.max(deltaQuantity, coindcxQuantity);
    const qtyDiff = Math.abs(deltaQuantity - coindcxQuantity);
    const qtyDiffPct = maxQty > 0 ? (qtyDiff / maxQty) * 100 : 0;

    console.log(`Difference: ${qtyDiff.toFixed(4)} (${qtyDiffPct.toFixed(2)}%) | Tolerance: ${(this.quantityTolerance * 100).toFixed(1)}%`);

    if (qtyDiffPct > this.quantityTolerance * 100) {
      console.log('❌ QUANTITY MISMATCH → EMERGENCY EXIT');

      // Emit event for dashboard
      this.emit('quantityMismatch', {
        deltaQty: deltaQuantity,
        coindcxQty: coindcxQuantity,
        differencePct: qtyDiffPct,
        deltaPosition,
        coindcxPosition
      });

      await this.emergencyExit('QUANTITY_MISMATCH', {
        reason: `Quantity mismatch exceeds ${this.quantityTolerance * 100}% tolerance`,
        deltaQuantity, coindcxQuantity, qtyDiffPct, deltaPosition,
        coindcxPosition
      });
    } else {
      console.log('✅ Quantity check passed');
    }
    console.log('='.repeat(60));
  }

  performFlipCheck() {
    if (!this.latestDeltaPosition || !this.latestCoindcxPosition) return;
    //  console.log('\n🔍 Performing Flip Safety Check...', this.latestDeltaPosition);
    const deltaSymbol = this.latestDeltaPosition.product_symbol;
    const coindcxSymbol = this.latestCoindcxPosition.symbol || this.latestCoindcxPosition.contractPair;

    const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
    const coindcxFRData = this.coindcxMonitor.getFundingRate(coindcxSymbol);

    if (!deltaFRData || !coindcxFRData) {
      console.log('⏳ Waiting for both funding rates...');
      console.log(`   Delta symbol: ${deltaSymbol} - FR: ${deltaFRData ? 'Found' : 'NOT FOUND'}`);
      console.log(`   Pi42 symbol: ${coindcxSymbol} - FR: ${coindcxFRData ? 'Found' : 'NOT FOUND'}`);
      return;
    }

    // Both rates are stored as decimals, convert to percentage
    const FR_delta = deltaFRData.rate;
    const FR_coindcx = coindcxFRData.rate;

    console.log('\n🔄 FLIP SAFETY CHECK');
    console.log('─'.repeat(60));
    console.log(`Delta FR:  ${FR_delta.toFixed(4)}%`);
    console.log(`Coindcx FR:   ${FR_coindcx.toFixed(4)}%`);

    let FR_first, FR_second, exchange_first, exchange_second;

    if (Math.abs(FR_delta) >= Math.abs(FR_coindcx)) {
      FR_first = FR_delta;
      FR_second = FR_coindcx;
      exchange_first = 'Delta';
      exchange_second = 'Coindcx';
    } else {
      FR_first = FR_coindcx;
      FR_second = FR_delta;
      exchange_first = 'Coindcx';
      exchange_second = 'Delta';
    }

    const diff = this.calculateFundingDifference(FR_first, FR_second);

    console.log(`Funding Rate Diff (${exchange_first} - ${exchange_second}): ${diff.toFixed(4)}%`);
    console.log(`Threshold: ${this.minProfitThreshold * 100}%`);

    if (diff < this.minProfitThreshold * 100) {
      console.log('❌ FLIP DETECTED → EMERGENCY EXIT');
      console.log('─'.repeat(60));

      this.emit('flip', { diff, threshold: this.minProfitThreshold * 100, FR_delta, FR_coindcx });

      this.emergencyExit('FLIP_DETECTED', {
        reason: `Funding profit dropped to ${diff.toFixed(4)}% < threshold ${this.minProfitThreshold * 100}%`,
        currentDiff: diff,
        deltaFR: FR_delta,
        coindcxFR: FR_coindcx,
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition
      });
    } else {
      console.log(`✅ Flip safe: ${diff.toFixed(4)}% profit remains`);
      console.log('─'.repeat(60));
    }
  }

  checkForNormalExit() {
    if (!this.latestDeltaPosition || !this.latestCoindcxPosition) return;

    const deltaSymbol = this.latestDeltaPosition.product_symbol;
    const frData = this.deltaMonitor.getFundingRate(deltaSymbol);

    // Check if funding rate data exists
    if (!frData) {
      console.log('⏳ Waiting for Delta funding rate data...');
      console.log(`   Symbol: ${deltaSymbol} - FR: NOT FOUND`);
      return;
    }

    const now = Date.now();
    const timeToFunding = frData.nextFundingTime - now;

    // Check if funding time passed by 10-15 seconds (configurable)
    const delayAfterFunding = 30000; // 30 seconds (10-15 range)
    const timeSinceFunding = Math.abs(timeToFunding);

    console.log('\n⏰ Normal Exit Check:');
    console.log(`   Current time: ${new Date(now).toLocaleTimeString()}`);
    console.log(`   Next funding: ${new Date(frData.nextFundingTime).toLocaleTimeString()}`);
    console.log(`   Time to funding: ${(timeToFunding / 1000).toFixed(0)}s`);
    console.log(`   Delay after funding: ${(delayAfterFunding / 1000).toFixed(0)}s`)

    if (timeToFunding <= 0 && timeSinceFunding >= delayAfterFunding) {
      console.log('\n⏰ FUNDING PERIOD COMPLETED → NORMAL EXIT');
      console.log(`   Waited ${(timeSinceFunding / 1000).toFixed(0)}s after funding`);

      this.emit('normalExit', {
        reason: 'Funding period completed',
        nextFundingTime: new Date(frData.nextFundingTime).toLocaleString(),
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition
      });

      this.normalExit({
        reason: 'Scheduled exit at funding time',
        fundingTimeReached: true,
        deltaPosition: this.latestDeltaPosition,
        coindcxPosition: this.latestCoindcxPosition
      });
    }
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
    console.log('\n🚨🚨🚨 EMERGENCY EXIT TRIGGERED 🚨🚨🚨');
    console.log(`Reason: ${reason}`);
    console.log('='.repeat(60));

    this.emit('emergencyExit', {
      reason,
      details,
      activeTrade: this.activeTrade,
      timestamp: new Date().toISOString()
    });

    this.unregisterTrade(); // Stop monitoring
  }

  async normalExit(details) {
    console.log('\n🔔 NORMAL EXIT INITIATED');
    console.log('='.repeat(60));
    console.log('Reason: Funding period completed (scheduled exit)');

    this.emit('normalExit', {
      ...details,
      activeTrade: this.activeTrade,
      timestamp: new Date().toISOString()
    });

    this.unregisterTrade();
  }

  registerTrade(trade) {
    console.log('\n📝 TRADE REGISTERED FOR MONITORING');
    console.log('='.repeat(60));
    console.log(`Delta: ${trade.deltaSymbol} | Coindcx: ${trade.coindexSymbol}`);
    console.log('='.repeat(60));

    this.activeTrade = {
      ...trade,
      registeredAt: Date.now()
    };

    this.emit('tradeRegistered', this.activeTrade);
  }

  unregisterTrade() {
    console.log('🛑 Monitoring stopped - trade closed');
    this.activeTrade = null;
    this.latestDeltaPosition = null;
    this.latestCoindcxPosition = null;
  }

  async start() {
    console.log('\n🚀 Starting Enhanced Trade Monitor');
    console.log('='.repeat(60));

    this.deltaMonitor.connect();
    await this.coindcxMonitor.connect();

    console.log('✅ Monitor active: Quantity + Flip + Normal Exit protection enabled');
    console.log('='.repeat(60));
  }

  stop() {
    console.log('\n🛑 Stopping Trade Monitor...');
    this.deltaMonitor.disconnect();
    this.coindcxMonitor.disconnect();
    this.unregisterTrade();
    console.log('✅ Monitor stopped');
  }
}

export default TradeMonitor;