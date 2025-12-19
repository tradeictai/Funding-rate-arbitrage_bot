import { io } from 'socket.io-client';
import EventEmitter from 'events';
import config from '../config/config.js';
import symbolMapper from '../utils/symbolMapper.js';

/**
 * Pi42 Exchange WebSocket Handler
 * Fetches funding rates and market data via Socket.IO
 */
class Pi42Exchange extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.data = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 4000;
    this.isConnected = false;
  }

  /**
   * Start WebSocket connection
   */
  connect() {
    this.ws = io(config.exchanges.pi42.wsUrl, {
      reconnection: true,
      reconnectionDelay: this.reconnectDelay,
      reconnectionAttempts: this.maxReconnectAttempts,
      transports: ['websocket']
    });

    this.ws.on('connect', () => {
      console.log('✅ Connected to Pi42 Exchange WebSocket');
      this.isConnected = true;
      this.reconnectAttempts = 0;

      // Subscribe to markPriceArr channel
      this.ws.emit('subscribe', {
        params: ['markPriceArr']
      });

      console.log('📡 Pi42: Subscribed to markPriceArr channel');
      this.emit('connected', { exchange: 'pi42' });
    });

    // Main stream: mark price + funding info
    this.ws.on('markPriceArr', (data) => {
      console.log('📥 Pi42: Received markPriceArr event');
      this.handleMarkPriceArray(data);
    });

    // Handle unexpected events for debugging
    this.ws.onAny((event, ...args) => {
      if (event !== 'markPriceArr' && event !== 'connect' && event !== 'disconnect' && event !== 'pong') {
        console.log(`🔔 Pi42 Event: ${event}`, args.length > 0 ? JSON.stringify(args[0]).substring(0, 200) : 'no data');
      }
    });

    this.ws.on('disconnect', (reason) => {
      console.log('❌ Pi42 WebSocket disconnected:', reason);
      this.isConnected = false;
      this.emit('disconnected', { exchange: 'pi42', reason });
    });

    this.ws.on('error', (err) => {
      console.error('⚠️ Pi42 WS ERROR:', err);
      this.emit('error', { exchange: 'pi42', error: err });
    });

    this.ws.on('reconnect_attempt', (attempt) => {
      this.reconnectAttempts = attempt;
      console.log(`🔄 Pi42: Reconnection attempt ${attempt}/${this.maxReconnectAttempts}`);
    });

    this.ws.on('reconnect_failed', () => {
      console.error('❌ Pi42: Max reconnection attempts reached');
      this.emit('maxReconnectReached', { exchange: 'pi42' });
    });
  }

  /**
   * Handle markPriceArr data
   * @param {Array} data - Array of token data
   */
  handleMarkPriceArray(data) {
    if (!Array.isArray(data)) {
      console.warn('⚠️ Pi42: Received non-array markPriceArr data:', typeof data);
      return;
    }

    console.log(`\n==== Pi42: RECEIVED ${data.length} TOKENS ====`);

    data.forEach((token, index) => {
      const symbol = token.s;  // Pi42 symbol (e.g., "BTC_USDT")
      const markPrice = token.p;
      const fundingRate = token.r * 100;  // Convert to percentage
      const lastFundingRate = token.lr * 100;  // Convert to percentage
      const nextFundingTime = token.T;  // Timestamp in milliseconds

      let remainingSeconds = null;
      if (nextFundingTime && nextFundingTime > 0) {
        remainingSeconds = Math.floor((nextFundingTime - Date.now()) / 1000);
      }

      const dataObj = {
        symbol,
        exchange: 'pi42',
        fundingRate,
        lastFundingRate,
        nextFundingTime,
        remainingSeconds,
        markPrice,
        lastPrice: markPrice,  // Pi42 doesn't separate mark and last price in this stream
        timestamp: Date.now(),
        raw: token
      };

      // Store in memory
      this.data.set(symbol, dataObj);

      // Emit update event
      this.emit('update', dataObj);

      if (config.env === 'development' && index < 5) {  // Log first 5 tokens
        this.logUpdate(dataObj, index + 1);
      }
    });

    // Emit batch update event
    this.emit('batchUpdate', { exchange: 'pi42', count: data.length });

    console.log(`==== Pi42: Processed ${data.length} tokens, stored in memory ====\n`);
  }

  /**
   * Log update (for development)
   */
  logUpdate(data, index) {
    console.log(`
---------------------------------------
#${index}
Token:              ${data.symbol}
Mark Price:         ${data.markPrice}
Funding Rate:       ${data.fundingRate.toFixed(4)}%
Last Funding Rate:  ${data.lastFundingRate.toFixed(4)}%
Next Funding At:    ${data.nextFundingTime ? new Date(data.nextFundingTime).toLocaleString() : 'N/A'}
Time Remaining:     ${data.remainingSeconds !== null ? this.formatCountdown(data.remainingSeconds) : 'N/A'}
---------------------------------------`);
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
   * Get funding data for a specific symbol
   * @param {string} symbol - Pi42 symbol (e.g., "BTC_USDT")
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
    const symbols = Array.from(this.data.values())
      .filter(d => d.fundingRate !== null && d.fundingRate !== undefined)
      .sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));

    return symbols;
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.ws) {
      this.ws.disconnect();
      this.ws = null;
      this.isConnected = false;
      console.log('🔌 Pi42 WebSocket disconnected');
    }
  }

  /**
   * Check if connected
   * @returns {boolean}
   */
  isConnectionActive() {
    return this.isConnected && this.ws && this.ws.connected;
  }
}

export default Pi42Exchange;
