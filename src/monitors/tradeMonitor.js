import EventEmitter from 'events';
import DeltaPositionMonitor from './deltaPositionMonitor.js';
import Pi42PositionMonitor from './pi42PositionMonitor.js';
import config from '../config/config.js';

/**
 * Trade Monitor - Enhanced Phase 4+
 * - Quantity mismatch check
 * - Real-time Flip Safety (on every update)
 * - Auto Normal Exit at funding time completion
 */
class TradeMonitor extends EventEmitter {
  constructor(deltaExchange, pi42Exchange) {
    super();

    this.deltaMonitor = new DeltaPositionMonitor();
    this.pi42Monitor = new Pi42PositionMonitor();

    // Remove dependency on external exchange funding fetchers
    this.deltaExchange = deltaExchange;
    this.pi42Exchange = pi42Exchange;

    this.activeTrade = null;
    this.latestDeltaPosition = null;
    this.latestPi42Position = null;

    this.quantityTolerance = config.trading.quantityTolerance || 0.05; // 5%
    this.minProfitThreshold = config.trading.minProfitThreshold || 0.01; // e.g. 0.01%

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
    this.pi42Monitor.on('position', (data) => {

      console.log('Pi42 position event received:', data);
      this.handlePi42Position(data);
    });

    // Listen to funding rate updates for real-time flip detection
    this.deltaMonitor.on('funding_rate', () => {
      if ( this.latestDeltaPosition && this.latestPi42Position) {
        this.performFlipCheck();
      }
    });

    this.pi42Monitor.on('funding_rate', () => {
      if (this.latestDeltaPosition && this.latestPi42Position) {
        this.performFlipCheck();
      }
    });
  }

  async handleDeltaPosition(data) {
    const { type, position } = data;

    console.log(`\n🔔 Delta Position Event: ${type.toUpperCase()}`);
    console.log(`   Symbol: ${position.product_symbol} | Size: ${Math.abs(position.size || 0)}`);

    this.latestDeltaPosition = position;

    if (this.latestPi42Position && this.activeTrade) {
      this.checkForNormalExit();
      await this.performQuantityCheck(this.latestDeltaPosition, this.latestPi42Position);
      this.performFlipCheck();           // Check flip on every Delta update
               // Check if funding time completed
    }
  }

  async handlePi42Position(data) {
    const { type, position } = data;

    console.log(`\n🔔 Pi42 Position Event: ${type.toUpperCase()}`);
    console.log(`   Symbol: ${position.symbol || position.contractPair} | Amount: ${Math.abs(position.positionAmount || 0)}`);

    this.latestPi42Position = position;

    if (this.latestDeltaPosition && this.activeTrade) {
      await this.performQuantityCheck(this.latestDeltaPosition, this.latestPi42Position);
      this.performFlipCheck();           // Check flip on every Pi42 update
      this.checkForNormalExit();         // Check if funding time completed
    }
  }

  async performQuantityCheck(deltaPosition, pi42Position) {
    if (!deltaPosition || !pi42Position) return;

    const deltaSize = Math.abs(deltaPosition.size || 0);
    const deltaContractValue = parseFloat(deltaPosition.product?.contract_value || 1);
    const deltaQuantity = deltaSize * deltaContractValue;
    const pi42Quantity = Math.abs(pi42Position.positionAmount || 0);

    console.log('\n🔍 QUANTITY CHECK');
    console.log('='.repeat(60));
    console.log(`Delta: ${deltaQuantity.toFixed(4)} (${deltaSize} × ${deltaContractValue})`);
    console.log(`Pi42:  ${pi42Quantity.toFixed(4)}`);

    const maxQty = Math.max(deltaQuantity, pi42Quantity);
    const qtyDiff = Math.abs(deltaQuantity - pi42Quantity);
    const qtyDiffPct = maxQty > 0 ? (qtyDiff / maxQty) * 100 : 0;

    console.log(`Difference: ${qtyDiff.toFixed(4)} (${qtyDiffPct.toFixed(2)}%) | Tolerance: ${(this.quantityTolerance * 100).toFixed(1)}%`);

    if (qtyDiffPct > this.quantityTolerance * 100) {
      console.log('❌ QUANTITY MISMATCH → EMERGENCY EXIT');

      // Emit event for dashboard
      this.emit('quantityMismatch', {
        deltaQty: deltaQuantity,
        pi42Qty: pi42Quantity,
        differencePct: qtyDiffPct
      });

      await this.emergencyExit('QUANTITY_MISMATCH', {
        reason: `Quantity mismatch exceeds ${this.quantityTolerance * 100}% tolerance`,
        deltaQuantity, pi42Quantity, qtyDiffPct
      });
    } else {
      console.log('✅ Quantity check passed');
    }
    console.log('='.repeat(60));
  }

  performFlipCheck() {
    if ( !this.latestDeltaPosition || !this.latestPi42Position) return;
    //  console.log('\n🔍 Performing Flip Safety Check...', this.latestDeltaPosition);
    const deltaSymbol = this.latestDeltaPosition.product_symbol;
    const pi42Symbol = this.latestPi42Position.symbol || this.latestPi42Position.contractPair;

    const deltaFRData = this.deltaMonitor.getFundingRate(deltaSymbol);
    const pi42FRData = this.pi42Monitor.getFundingRate(pi42Symbol);

    if (!deltaFRData || !pi42FRData) {
      console.log('⏳ Waiting for both funding rates...');
      console.log(`   Delta symbol: ${deltaSymbol} - FR: ${deltaFRData ? 'Found' : 'NOT FOUND'}`);
      console.log(`   Pi42 symbol: ${pi42Symbol} - FR: ${pi42FRData ? 'Found' : 'NOT FOUND'}`);
      return;
    }

    // Both rates are stored as decimals, convert to percentage
    const FR_delta = deltaFRData.rate;
    const FR_pi42 = pi42FRData.rate * 100;

    console.log('\n🔄 FLIP SAFETY CHECK');
    console.log('─'.repeat(60));
    console.log(`Delta FR:  ${FR_delta.toFixed(4)}%`);
    console.log(`Pi42 FR:   ${FR_pi42.toFixed(4)}%`);

    let FR_first, FR_second, exchange_first, exchange_second;

    if (Math.abs(FR_delta) >= Math.abs(FR_pi42)) {
      FR_first = FR_delta;
      FR_second = FR_pi42;
      exchange_first = 'Delta';
      exchange_second = 'Pi42';
    } else {
      FR_first = FR_pi42;
      FR_second = FR_delta;
      exchange_first = 'Pi42';
      exchange_second = 'Delta';
    }

    const diff = this.calculateFundingDifference(FR_first, FR_second);

    console.log(`Funding Rate Diff (${exchange_first} - ${exchange_second}): ${diff.toFixed(4)}%`);
    console.log(`Threshold: ${this.minProfitThreshold * 100}%`);

    if (diff < this.minProfitThreshold * 100) {
      console.log('❌ FLIP DETECTED → EMERGENCY EXIT');
      console.log('─'.repeat(60));

      this.emit('flip', { diff, threshold: this.minProfitThreshold * 100, FR_delta, FR_pi42 });

      this.emergencyExit('FLIP_DETECTED', {
        reason: `Funding profit dropped to ${diff.toFixed(4)}% < threshold ${this.minProfitThreshold * 100}%`,
        currentDiff: diff,
        deltaFR: FR_delta,
        pi42FR: FR_pi42,
        deltaPosition: this.latestDeltaPosition,
        pi42Position: this.latestPi42Position
      });
    } else {
      console.log(`✅ Flip safe: ${diff.toFixed(4)}% profit remains`);
      console.log('─'.repeat(60));
    }
  }

  checkForNormalExit() {
    if (!this.latestPi42Position) return;

    const deltaSymbol = this.latestDeltaPosition.product_symbol;
    const frData = this.deltaMonitor.getFundingRate(deltaSymbol);

    const now = Date.now();
    const timeToFunding = frData.nextFundingTime - now;

    // Check if funding time passed by 10-15 seconds (configurable)
    const delayAfterFunding = 30000; // 30 seconds (10-15 range)
    const timeSinceFunding = Math.abs(timeToFunding);

    if (timeToFunding <= 0 && timeSinceFunding >= delayAfterFunding) {
      console.log('\n⏰ FUNDING PERIOD COMPLETED → NORMAL EXIT');
      console.log(`   Waited ${(timeSinceFunding / 1000).toFixed(0)}s after funding`);

      this.emit('normalExit', {
        reason: 'Funding period completed',
        nextFundingTime: new Date(frData.nextFundingTime).toLocaleString(),
        deltaPosition: this.latestDeltaPosition,
        pi42Position: this.latestPi42Position
      });

      this.normalExit({
        reason: 'Scheduled exit at funding time',
        fundingTimeReached: true,
        details: {
          deltaPosition: this.latestDeltaPosition,
          pi42Position: this.latestPi42Position
        }
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
    console.log(`Delta: ${trade.deltaSymbol} | Pi42: ${trade.pi42Symbol}`);
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
    this.latestPi42Position = null;
  }

  async start() {
    console.log('\n🚀 Starting Enhanced Trade Monitor');
    console.log('='.repeat(60));

    this.deltaMonitor.connect();
    await this.pi42Monitor.connect();

    console.log('✅ Monitor active: Quantity + Flip + Normal Exit protection enabled');
    console.log('='.repeat(60));
  }

  stop() {
    console.log('\n🛑 Stopping Trade Monitor...');
    this.deltaMonitor.disconnect();
    this.pi42Monitor.disconnect();
    this.unregisterTrade();
    console.log('✅ Monitor stopped');
  }
}

export default TradeMonitor;