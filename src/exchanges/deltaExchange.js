import { WebSocket } from 'ws';
import EventEmitter from 'events';
import config from '../config/config.js';
import symbolMapper from '../utils/symbolMapper.js';

/**
 * Delta Exchange WebSocket Handler
 * Fetches funding rates and market data via WebSocket
 */
class DeltaExchange extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.data = new Map();
    this.fundingTimes = new Map(); // Store exact funding times per symbol
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 4000;
    this.isConnected = false;
    this.subscribedSymbols = [];
  }

  /**
   * Start WebSocket connection
   * @param {Array<string>} symbols - Array of Delta symbols (e.g., ["BTCUSD", "ETHUSD"])
   */
  connect(symbols = null) {
    if (!symbols) {
      symbols = symbolMapper.getSupportedDeltaSymbols();
    }

    this.subscribedSymbols = symbols;
    this.ws = new WebSocket(config.exchanges.delta.wsUrl);

    this.ws.on('open', () => {
      console.log('✅ Connected to Delta Exchange WebSocket');
      this.isConnected = true;
      this.reconnectAttempts = 0;

      // Subscribe to BOTH funding_rate channel (for exact funding times) AND v2/ticker channel
      const subscribeMessage = {
        type: 'subscribe',
        payload: {
          channels: [
            // Funding rate channel - provides exact next funding time
            {
              name: 'funding_rate',
              symbols: symbols
            },
            // Ticker channel - provides price and current funding rate
            ...symbols.map(symbol => ({
              name: 'v2/ticker',
              symbols: [symbol]
            }))
          ]
        }
      };

      this.ws.send(JSON.stringify(subscribeMessage));
      console.log(`📡 Delta: Subscribed to ${symbols.length} perpetual contracts`);
      console.log(`📡 Delta: Channels - funding_rate + v2/ticker`);

      this.emit('connected', { exchange: 'delta', symbols });
    });

    this.ws.on('message', (raw) => {
      this.handleMessage(raw);
    });

    this.ws.on('close', () => {
      console.log('❌ Delta WebSocket closed');
      this.isConnected = false;
      this.emit('disconnected', { exchange: 'delta' });
      this.handleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('⚠️ Delta WS ERROR:', err.message);
      this.emit('error', { exchange: 'delta', error: err });
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      console.error('Failed to parse Delta message:', err);
      return;
    }

    // Ignore subscription confirmations
    if (msg.type === 'subscriptions') {
      return;
    }

    // ==========================================
    // HANDLE FUNDING_RATE CHANNEL
    // ==========================================
    if (msg.type === 'funding_rate' && msg.symbol) {
      const symbol = msg.symbol;

      // Store the exact next funding time from this channel
      // Field is "next_funding_realization" in microseconds
      if (msg.next_funding_realization) {
        // Convert microseconds to milliseconds
        const nextFundingMs = Math.floor(msg.next_funding_realization / 1000);
        this.fundingTimes.set(symbol, nextFundingMs);

        if (config.env === 'development') {
          const fundingDate = new Date(nextFundingMs);
          const remaining = this.formatCountdown(Math.floor((nextFundingMs - Date.now()) / 1000));
          console.log(`\n✅ Funding time stored for ${symbol}:`);
          console.log(`   Next Funding: ${fundingDate.toLocaleString()}`);
          console.log(`   Time Remaining: ${remaining}`);
          console.log(`   Funding Interval: ${msg.funding_interval}s (${msg.funding_interval/3600}h)\n`);
        }
      }

      // Also update funding rate if available (only if we have existing data)
      if (msg.funding_rate !== undefined) {
        const existing = this.data.get(symbol);
        if (existing) {
          // Only update if we already have a data object from v2/ticker
          existing.fundingRate = Number(msg.funding_rate);
          this.data.set(symbol, existing);
        }
        // If no existing data, wait for v2/ticker to create the full object
      }

      return;
    }

    // ==========================================
    // HANDLE V2/TICKER CHANNEL
    // ==========================================
    if (msg.type !== 'v2/ticker' || !msg.symbol) {
      return;
    }

    const symbol = msg.symbol;

    // Parse funding rate (Delta sends as decimal percentage, e.g., 0.0315 for 0.0315%)
    let fundingRate = null;
    if (msg.funding_rate !== undefined && msg.funding_rate !== null) {
      fundingRate = Number(msg.funding_rate); // Already in percentage format
    }

    // Get stored next funding time (from funding_rate channel)
    let nextFundingTime = this.fundingTimes.get(symbol) || null;
    let remainingSeconds = null;

    if (nextFundingTime) {
      const now = Date.now();
      const timeRemaining = nextFundingTime - now;
      remainingSeconds = Math.floor(timeRemaining / 1000);
    }

    // Parse other data
    const markPrice = msg.mark_price || msg.close || msg.last_price || null;
    const lastPrice = msg.last_price || msg.close || null;
    const volume = msg.volume || msg.turnover || null;
    const openInterest = msg.open_interest || null;

    const data = {
      symbol,
      exchange: 'delta',
      fundingRate,
      nextFundingTime,
      remainingSeconds,
      markPrice,
      lastPrice,
      volume,
      openInterest,
      timestamp: Date.now(),
      raw: msg
    };

    // Store in memory
    this.data.set(symbol, data);

    // Emit update event
    this.emit('update', data);

    if (config.env === 'development') {
      this.logUpdate(data);
    }
  }

  /**
   * Log update (for development)
   */
  logUpdate(data) {
    console.log('\n📨 Delta Real-Time Update');
    console.log('==========================');
    console.log('Symbol:'.padEnd(20), data.symbol);
    console.log('Funding Rate:'.padEnd(20),
      data.fundingRate !== null ? data.fundingRate.toFixed(4) + '%' : 'N/A'
    );
    console.log('Next Funding:'.padEnd(20),
      data.nextFundingTime ? new Date(data.nextFundingTime).toLocaleString() : 'N/A'
    );
    console.log('Time Remaining:'.padEnd(20),
      data.remainingSeconds ? this.formatCountdown(data.remainingSeconds) : 'N/A'
    );
    console.log('Mark Price:'.padEnd(20), data.markPrice || 'N/A');
    console.log('Volume:'.padEnd(20), data.volume || 'N/A');
    console.log('==========================\n');
  }

  /**
   * Format countdown from seconds
   */
  formatCountdown(seconds) {
    if (seconds <= 0) return 'Funding period passed';

    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');

    return `${h}:${m}:${s}`;
  }

  /**
   * Handle reconnection
   */
  handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ Delta: Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
      this.emit('maxReconnectReached', { exchange: 'delta' });
      return;
    }

    this.reconnectAttempts++;
    console.log(`🔄 Delta: Reconnecting in ${this.reconnectDelay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect(this.subscribedSymbols);
    }, this.reconnectDelay);
  }

  /**
   * Get funding data for a specific symbol
   * @param {string} symbol - Delta symbol
   * @returns {Object|null}
   */
  getFundingData(symbol) {
    return this.data.get(symbol) || null;
  }

  /**
   * Get all funding data
   * @returns {Map}
   */
  getAllFundingData() {
    return this.data;
  }

  /**
   * Get symbols sorted by absolute funding rate (highest first)
   * @returns {Array<Object>}
   */
  getSymbolsSortedByFundingRate() {
    // console.log(this.data)
    const symbols = Array.from(this.data.values())
      .filter(d => d.fundingRate !== null)
      .sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));
      // console.log(symbols)
    return symbols;
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      console.log('🔌 Delta WebSocket disconnected');
    }
  }

  /**
   * Check if connected
   * @returns {boolean}
   */
  isConnectionActive() {
    return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

export default DeltaExchange;
