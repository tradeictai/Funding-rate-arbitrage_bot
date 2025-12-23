import io from 'socket.io-client';
import axios from 'axios';
import crypto from 'crypto';
import EventEmitter from 'events';
import config from '../config/config.js';
import pi42API from '../services/pi42API.js'; // Your existing API client

/**
 * Pi42 Position + Funding Rate Monitor (Private + Public WS Combined)
 * - Private authenticated WS for positions
 * - Additional public WS for real-time funding rates (markPriceArr stream)
 * - Tracks funding only for symbols with open positions
 * - Calculates next funding time (every 8 hours: 00:00, 08:00, 16:00 UTC)
 */
class Pi42PositionMonitor extends EventEmitter {
  constructor() {
    super();
    this.privateSocket = null;      // Authenticated user data stream
    this.publicSocket = null;       // Public markPriceArr stream
    this.listenKey = null;
    this.keepAliveInterval = null;
    this.positions = new Map();     // symbol -> position data
    this.fundingRates = new Map();  // symbol -> { rate, lastRate, nextFundingTime, timeRemaining }

    this.apiKey = config.orderPlace.pi42.apiKey;
    this.apiSecret = config.orderPlace.pi42.apiSecret;
    this.restBaseUrl = 'https://fapi.pi42.com';
    this.authWsBase = 'https://fawss-uds.pi42.com/auth-stream';
    this.publicWsUrl = 'https://fawss.pi42.com'; // Public WS endpoint

    this.isConnected = false;
    this.lastUpdateReceived = null;
    this.messageCount = 0;
    this.statusInterval = null;
  }

  // --- Next Funding Time (Pi42: every 8 hours at 00:00, 08:00, 16:00 UTC) ---
  getNextFundingTime() {
    const now = Date.now();
    const fundingHoursUTC = [0, 8, 16];
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);

    for (const hour of fundingHoursUTC) {
      const candidate = new Date(today);
      candidate.setUTCHours(hour);
      if (candidate.getTime() > now) {
        return candidate.getTime();
      }
    }
    // Next day 00:00 UTC
    const next = new Date(today);
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0);
    return next.getTime();
  }

  formatTimeRemaining(ms) {
    if (ms <= 0) return 'Now!';
    const totalSeconds = Math.floor(ms / 1000);
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  // --- Generate Signature ---
  generateSignature(body) {
    const bodyStr = JSON.stringify(body);
    return crypto.createHmac('sha256', this.apiSecret).update(bodyStr).digest('hex');
  }

  // --- Create Listen Key (Private WS) ---
  async createListenKey() {
    const body = { timestamp: Date.now().toString() };
    const signature = this.generateSignature(body);

    try {
      const response = await axios.post(
        `${this.restBaseUrl}/v1/retail/listen-key`,
        body,
        {
          headers: {
            'api-key': this.apiKey,
            signature: signature,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data && response.data.listenKey) {
        this.listenKey = response.data.listenKey;
        console.log('✅ Pi42: Listen Key obtained');
        return this.listenKey;
      } else {
        throw new Error('No listenKey in response');
      }
    } catch (error) {
      console.error('❌ Pi42: Failed to create listen key', error.response?.data || error.message);
      throw error;
    }
  }

  // --- Fetch Initial Positions via REST ---
  async fetchInitialPositions() {
    try {
      console.log('📊 Pi42: Fetching initial open positions...');
      const positions = await pi42API.getPositions();

      console.log(`   Found ${positions.length} open position(s)\n`);

      this.positions.clear();

      if (positions.length === 0) {
        console.log('   ⚠️ No open positions on Pi42\n');
        this.emit('snapshot', { positions: [], count: 0 });
        return;
      }

      positions.forEach((pos) => {
        // Normalize symbol field: contractPair or symbol
        const symbol = (pos.contractPair || pos.symbol || '').toUpperCase();
        pos.symbol = symbol; // Ensure symbol is set

        this.printCompactLiveUpdate(pos);
        this.positions.set(symbol, pos);
        this.emit('position', { exchange: 'pi42', type: 'snapshot', position: pos });
      });

      this.emit('snapshot', { positions: Array.from(this.positions.values()), count: positions.length });
      console.log('⏳ Monitoring live position updates + funding rates...\n');
      this.startStatusUpdates();

    } catch (error) {
      console.error('❌ Failed to fetch initial positions:', error.message);
    }
  }

  // --- Print Compact Update ---
  printCompactLiveUpdate(data, prevData = null) {
    const time = new Date().toLocaleTimeString();
    const pnl = parseFloat(data.unrealisedPnl || data.unrealizedPnl || 0);
    const pnlColor = pnl >= 0 ? '🟢' : '🔴';
    const side = (data.positionAmount || 0) > 0 ? 'LONG' : 'SHORT';

    const frData = this.fundingRates.get(data.symbol);
    const frText = frData ? `${(frData.rate * 100).toFixed(4)}% → ${this.formatTimeRemaining(frData.timeRemaining)}` : 'Loading...';

    console.log(
      `   ${pnlColor} [${time}] ${data.symbol} ${side} ` +
      `| Mark: ${data.markPrice?.toFixed(2) || 'N/A'} ` +
      `| PnL: ${pnl.toFixed(2)} INR ` +
      `| FR: ${frText}`
    );

    if (prevData) {
      const prevPnl = parseFloat(prevData.unrealisedPnl || prevData.unrealizedPnl || 0);
      const pnlDiff = pnl - prevPnl;
      if (Math.abs(pnlDiff) > 0.01) {
        const arrow = pnlDiff >= 0 ? '↑' : '↓';
        console.log(`      ⚡ PnL Change: ${arrow} ${Math.abs(pnlDiff).toFixed(2)} INR`);
      }
    }
    console.log('');
  }

  // --- Status Updates (Heartbeat) ---
  startStatusUpdates() {
    this.stopStatusUpdates();
    this.statusInterval = setInterval(() => {
      const now = Date.now();
      const secsAgo = this.lastUpdateReceived ? Math.floor((now - this.lastUpdateReceived) / 1000) : null;

      const time = new Date().toLocaleTimeString();
      let status = `\n💚 [${time}] Pi42 Active | Messages: ${this.messageCount}`;

      if (secsAgo !== null) {
        status += ` | Last Update: ${secsAgo}s ago${secsAgo > 30 ? ' (quiet)' : ''}`;
      }

      status += `\n   📊 Open Positions: ${this.positions.size}`;
      if (this.positions.size > 0) {
        this.positions.forEach((pos) => {
          const pnl = parseFloat(pos.unrealisedPnl || pos.unrealizedPnl || 0);
          const pnlColor = pnl >= 0 ? '🟢' : '🔴';
          const frData = this.fundingRates.get(pos.symbol);
          const frText = frData ? `${(frData.rate * 100).toFixed(4)}% → ${this.formatTimeRemaining(frData.timeRemaining)}` : 'N/A';
          status += `\n   ${pnlColor} ${pos.symbol}: PnL ${pnl.toFixed(2)} INR | FR: ${frText}`;
        });
      }
      status += '\n';
      console.log(status);
    }, 10000);
  }

  stopStatusUpdates() {
    if (this.statusInterval) clearInterval(this.statusInterval);
  }

  // --- Connect Public Funding Rate WS ---
  connectPublicFundingWS() {
    console.log('🔌 Pi42: Connecting to public funding/mark price stream...');
    this.publicSocket = io(this.publicWsUrl, { transports: ['websocket'] });

    this.publicSocket.on('connect', () => {
      console.log('✅ Pi42: Public WS connected');
      this.publicSocket.emit('subscribe', { params: ['markPriceArr'] });
      console.log('📡 Subscribed to markPriceArr\n');
    });

    this.publicSocket.on('markPriceArr', (data) => {
      let dataArray = [];
      if (Array.isArray(data)) {
        dataArray = data;
      } else if (typeof data === 'object' && data !== null) {
        dataArray = Object.entries(data).map(([s, info]) => ({ s, ...info }));
      }

      const now = Date.now();
      const nextFundingMs = this.getNextFundingTime();

      dataArray.forEach((token) => {
        const symbol = (token.s || token.symbol || '').toUpperCase();
        if (!symbol) return;

        // Only store if we have an open position in this symbol (saves memory & focus)
        if (!this.positions.has(symbol)) return;

        const rate = parseFloat(token.r || token.fundingRate || 0);
        const lastRate = parseFloat(token.lr || token.lastFundingRate || 0);

        this.fundingRates.set(symbol, {
          rate,
          lastRate,
          nextFundingTime: nextFundingMs,
          timeRemaining: nextFundingMs - now
        });

        this.emit('funding_rate', {
          symbol,
          fundingRate: rate * 100, // percent
          lastFundingRate: lastRate * 100,
          nextFundingTime: nextFundingMs,
          timeRemaining: nextFundingMs - now
        });
      });
    });

    this.publicSocket.on('disconnect', () => {
      console.log('❌ Pi42 Public WS disconnected - reconnecting...');
      setTimeout(() => this.connectPublicFundingWS(), 5000);
    });
  }

  // --- Private WS Connection ---
  connectPrivateWS() {
    if (!this.listenKey) throw new Error('ListenKey required');

    const wsUrl = `${this.authWsBase}/${this.listenKey}`;
    console.log('🔌 Pi42: Connecting private position stream...');

    this.privateSocket = io(wsUrl, { transports: ['websocket'] });

    this.privateSocket.on('connect', () => {
      console.log('✅ Pi42: Private WS connected\n');
      this.isConnected = true;
      this.startKeepAlive();
      this.fetchInitialPositions(); // Get snapshot
    });

    // Position events
    this.privateSocket.on('newPosition', (data) => {
      const symbol = (data.contractPair || data.symbol || '').toUpperCase();
      data.symbol = symbol; // Normalize

      console.log('\n🆕 Pi42: NEW POSITION');
      this.printCompactLiveUpdate(data);
      this.positions.set(symbol, data);
      this.lastUpdateReceived = Date.now();
      this.emit('position', { exchange: 'pi42', type: 'new', position: data });
    });

    this.privateSocket.on('updatePosition', (data) => {
      const symbol = (data.contractPair || data.symbol || '').toUpperCase();
      data.symbol = symbol; // Normalize

      const prev = this.positions.get(symbol);
      console.log('\n🔄 Pi42: POSITION UPDATE');
      this.printCompactLiveUpdate(data, prev);
      this.positions.set(symbol, data);
      this.lastUpdateReceived = Date.now();
      this.emit('position', { exchange: 'pi42', type: 'update', position: data, previousPosition: prev });
    });

    this.privateSocket.on('closePosition', (data) => {
      const symbol = (data.contractPair || data.symbol || '').toUpperCase();
      data.symbol = symbol; // Normalize

      console.log('\n🚪 Pi42: POSITION CLOSED');
      this.printCompactLiveUpdate(data);
      this.positions.delete(symbol);
      this.fundingRates.delete(symbol); // Clean up
      this.lastUpdateReceived = Date.now();
      this.emit('position', { exchange: 'pi42', type: 'close', position: data });
    });

    this.privateSocket.on('disconnect', (reason) => {
      console.log('❌ Pi42 Private WS disconnected:', reason);
      this.isConnected = false;
      this.restart();
    });
  }

  // --- Keep Alive ---
  startKeepAlive() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.keepAliveInterval = setInterval(async () => {
      try {
        await axios.put(`${this.restBaseUrl}/v1/retail/listen-key`, {}, {
          headers: { 'api-key': this.apiKey }
        });
      } catch (err) {
        console.error('❌ Keep alive failed');
      }
    }, 30 * 60 * 1000);
  }

  // --- Public Getters ---
  getPositions() {
    return Array.from(this.positions.values());
  }

  getPositionBySymbol(symbol) {
    return this.positions.get(symbol.toUpperCase());
  }

  getFundingRate(symbol) {
    return this.fundingRates.get(symbol.toUpperCase());
  }

  getAllFundingRates() {
    return Object.fromEntries(this.fundingRates);
  }

  // --- Restart & Connect ---
  async restart() {
    this.stopStatusUpdates();
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    if (this.privateSocket) this.privateSocket.close();
    if (this.publicSocket) this.publicSocket.close();
    await this.connect();
  }

  async connect() {
    console.log('🚀 Starting Pi42 Position + Funding Monitor');
    console.log('='.repeat(60));
    await this.createListenKey();
    this.connectPrivateWS();
    this.connectPublicFundingWS(); // Separate public stream for funding
  }

  disconnect() {
    this.stopStatusUpdates();
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    if (this.privateSocket) this.privateSocket.close();
    if (this.publicSocket) this.publicSocket.close();
    this.positions.clear();
    this.fundingRates.clear();
    console.log('🔌 Pi42 Monitor disconnected');
  }
}

export default Pi42PositionMonitor;