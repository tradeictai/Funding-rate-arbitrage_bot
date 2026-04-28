import { WebSocket } from 'ws'; // Note: Use 'ws' package for native WebSocket (no socket.io)
import EventEmitter from 'events';

/**
 * Binance Futures Exchange WebSocket Handler
 * Fetches funding rates and mark price data via public WebSocket
 */
class BinanceExchange extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.data = new Map(); // symbol -> data object
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.isConnected = false;
    this.pingInterval = null;
  }

  /**
   * Start WebSocket connection to Binance Futures
   */
  connect() {
    // Public stream for ALL perpetual contracts mark price + funding rate (updates every 1 second)
    const streamUrl = 'wss://fstream.binance.com/market/stream?streams=!markPrice@arr';

    this.ws = new WebSocket(streamUrl);

    this.ws.on('open', () => {
      console.log('✅ Connected to Binance Futures WebSocket (!markPrice@arr)');
      this.isConnected = true;
      this.reconnectAttempts = 0;

      // Optional: Start ping to keep connection alive
      this.startPing();

      this.emit('connected', { exchange: 'binance' });
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.stream && msg.data && Array.isArray(msg.data)) {
          this.handleMarkPriceArray(msg.data);
        }
      } catch (err) {
        console.error('⚠️ Binance: Failed to parse message:', err.message);
      }
    });

    this.ws.on('error', (err) => {
      console.error('⚠️ Binance WS ERROR:', err.message);
      this.emit('error', { exchange: 'binance', error: err });
    });

    this.ws.on('close', (code, reason) => {
      console.log(`❌ Binance WebSocket closed (code: ${code})`, reason.toString());
      this.isConnected = false;
      this.stopPing();
      this.emit('disconnected', { exchange: 'binance', code, reason: reason.toString() });

      // Attempt manual reconnect if not intentional
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectAttempts++;
        console.log(`🔄 Binance: Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      } else {
        console.error('❌ Binance: Max reconnection attempts reached');
        this.emit('maxReconnectReached', { exchange: 'binance' });
      }
    });

    // Handle unexpected pong/ping from server
    this.ws.on('ping', () => this.ws.pong());
    this.ws.on('pong', () => {}); // Keep-alive response
  }

  /**
   * Keep connection alive with periodic pings
   */
  startPing() {
    this.stopPing(); // Clear any existing
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 15000); // Binance recommends < 30s
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Handle markPriceArr data from Binance
   * @param {Array} updates - Array of mark price objects
   */
  handleMarkPriceArray(updates) {
    if (!Array.isArray(updates) || updates.length === 0) {
      return;
    }

    console.log(`\n==== Binance: RECEIVED ${updates.length} SYMBOL UPDATES ====`);

    updates.forEach((update, index) => {
      // Binance symbol format: BTCUSDT
      const symbol = update.s;
      const markPrice = parseFloat(update.p);
      const indexPrice = parseFloat(update.i);
      const fundingRate = parseFloat(update.r) * 100; // Convert to percentage (e.g., 0.0001 -> 0.01%)
      const nextFundingTime = update.T; // milliseconds

      let remainingSeconds = null;
      if (nextFundingTime && nextFundingTime > Date.now()) {
        remainingSeconds = Math.floor((nextFundingTime - Date.now()) / 1000);
      }

      const dataObj = {
        symbol,
        exchange: 'binance',
        fundingRate,
        lastFundingRate: fundingRate, // Binance doesn't send separate last rate in this stream
        nextFundingTime,
        remainingSeconds,
        markPrice,
        indexPrice,
        lastPrice: markPrice, // Approximation (Binance has separate ticker stream for last price)
        timestamp: Date.now(),
        eventTime: update.E,
        raw: update
      };

      // Store in memory
      this.data.set(symbol, dataObj);

      // Emit per-symbol update
      this.emit('update', dataObj);

      // Log first few in development
      if (process.env.NODE_ENV === 'development' && index < 5) {
        this.logUpdate(dataObj, index + 1);
      }
    });

    // Emit batch update
    this.emit('batchUpdate', { exchange: 'binance', count: updates.length });

    console.log(`==== Binance: Processed ${updates.length} symbols, stored in memory ====\n`);
  }

  /**
   * Log update (for development)
   */
  logUpdate(data, index) {
//     console.log(`
// ---------------------------------------
// #${index}
// Token:              ${data.symbol}
// Mark Price:         ${data.markPrice}
// Index Price:        ${data.indexPrice}
// Funding Rate:       ${data.fundingRate.toFixed(4)}%
// Next Funding At:    ${data.nextFundingTime ? new Date(data.nextFundingTime).toLocaleString() : 'N/A'}
// Time Remaining:     ${data.remainingSeconds !== null ? this.formatCountdown(data.remainingSeconds) : 'N/A'}
// ---------------------------------------`);
  }

  /**
   * Format countdown from seconds
   */
  formatCountdown(seconds) {
    if (seconds <= 0) return 'Funding occurred';

    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');

    return `${h}:${m}:${s}`;
  }

  /**
   * Get funding data for a specific symbol
   * @param {string} symbol - Binance symbol (e.g., "BTCUSDT")
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
    return Array.from(this.data.values())
      .filter(d => d.fundingRate !== null && !isNaN(d.fundingRate))
      .sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      console.log('🔌 Binance WebSocket disconnected manually');
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

export default BinanceExchange;