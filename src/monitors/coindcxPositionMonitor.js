import io from 'socket.io-client';
import { WebSocket } from 'ws';
import crypto from 'crypto';
import EventEmitter from 'events';
import config from '../config/config.js';
import coindcxAPI from '../services/coindcxAPI.js';

/**
 * CoinDCX Position + Binance Funding Rate Monitor
 * - Private CoinDCX WS: Real-time position updates
 * - Public Binance WS: Accurate funding rates & countdown
 * - Only tracks symbols you have open positions in
 */
class CoinDCXPositionMonitor extends EventEmitter {
  constructor() {
    super();
    this.coindcxSocket = null;     // Private authenticated socket
    this.binanceSocket = null;     // Public funding rate socket
    this.positions = new Map();    // symbol -> position data (CoinDCX format)
    this.fundingRates = new Map(); // symbol -> { rate%, nextFundingTime, timeRemaining }

    this.apiKey = config.orderPlace.coindcx.apiKey;
    this.apiSecret = config.orderPlace.coindcx.apiSecret;

    this.isConnected = false;
    this.lastUpdate = null;
    this.messageCount = 0;
    this.statusInterval = null;
  }

  // --- Symbol Conversion: Binance ↔ CoinDCX ---
  // Binance: SONICUSDT → CoinDCX: B-SONIC_USDT
  binanceToCoinDCX(binanceSymbol) {
    // Remove common quote currencies and add underscore
    const converted = binanceSymbol.replace(/(USDT|USDC|BUSD)$/, '_$1');
    return `B-${converted}`;
  }

  // CoinDCX: B-SONIC_USDT → Binance: SONICUSDT
  coindcxToBinance(coindcxSymbol) {
    // Remove B- prefix and underscore
    return coindcxSymbol.replace(/^B-/, '').replace('_', '');
  }

  // --- Binance Next Funding Time (every 8h: 00:00, 08:00, 16:00 UTC) ---
  formatTimeRemaining(ms) {
    if (ms <= 0) return 'Now!';
    const totalSeconds = Math.floor(ms / 1000);
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  // --- Generate CoinDCX Auth Signature ---
  generateSignature() {
    const body = { channel: "coindcx" };
    const payload = Buffer.from(JSON.stringify(body)).toString(); // Critical format
    return crypto.createHmac('sha256', this.apiSecret).update(payload).digest('hex');
  }

  // --- Fetch Initial Positions via REST API ---
  async fetchInitialPositions() {
    try {
      const positions = await coindcxAPI.getPositions();
      console.log("get postions: ", positions)
      console.log(`✅ Fetched ${positions.length} existing position(s)\n`);

      if (positions.length === 0) {
        console.log('   No active positions found\n');
        return;
      }

      // Process each existing position
      positions.forEach(pos => {
        const symbol = pos.pair?.toUpperCase();
        if (!symbol) return;

        const activePos = parseFloat(pos.active_pos || 0);
        if (activePos === 0) return; // Skip flat positions

        const side = activePos > 0 ? 'LONG' : 'SHORT';
        const size = Math.abs(activePos);

        // Convert to Binance symbol for debugging
        const binanceSymbol = this.coindcxToBinance(symbol);
        console.log(`\n${side === 'LONG' ? '🟢' : '🔴'} [${new Date().toLocaleTimeString()}] ${symbol} ${side}`);
        console.log(`   Size: ${size} | Avg Price: ${parseFloat(pos.avg_price || 0).toFixed(6)}`);
        console.log(`   Leverage: ${pos.leverage}x | Margin: ${pos.margin_type}`);
        console.log(`   Binance Symbol: ${binanceSymbol} (for funding rate)`);

        // Store position
        this.positions.set(symbol, { ...pos, symbol, side, size, positionAmount: activePos });
        this.lastUpdate = Date.now();

        // Emit position event
        this.emit('position', {
          exchange: 'coindcx',
          type: 'snapshot',
          position: { ...pos, symbol, side, size, positionAmount: activePos },
          previous: null
        });
      });

      console.log('');
    } catch (error) {
      console.error('❌ Error fetching initial positions:', error.message);
    }
  }

  // --- Connect CoinDCX Private WS (Positions) ---
  connectCoinDCXPrivate() {
    console.log('🔌 Connecting to CoinDCX Private WebSocket...');
    this.coindcxSocket = io('wss://stream.coindcx.com', {
      transports: ['websocket']
    });

    this.coindcxSocket.on('connect', () => {
      console.log('✅ CoinDCX Private WS connected');
      const signature = this.generateSignature();
      this.coindcxSocket.emit('join', {
        channelName: 'coindcx',
        authSignature: signature,
        apiKey: this.apiKey
      });
      console.log('📡 Authenticated to private channel');

      // Fetch initial positions via REST API (WebSocket only provides updates)
      setTimeout(async () => {
        console.log('📡 Fetching initial positions via REST API...');
        await this.fetchInitialPositions();
      }, 1000);
    });

    // POSITION UPDATES (Real-time via WebSocket)
    // Per CoinDCX docs: response.data contains array of position objects
    this.coindcxSocket.on('df-position-update', (response) => {
      try {
        this.messageCount++;

        console.log('\n🔄 Position Update Received');
        console.log('Response:', JSON.stringify(response, null, 2));

        // Extract position data (docs show response.data is the array)
        const positions = Array.isArray(response.data) ? response.data :
                         (response.data ? [response.data] : []);

        if (positions.length === 0) {
          console.log('⚠️ Empty position update\n');
          return;
        }

        positions.forEach(pos => {
          const symbol = pos.pair?.toUpperCase();
          if (!symbol) return;

          const activePos = parseFloat(pos.active_pos || 0);
          const side = activePos > 0 ? 'LONG' : activePos < 0 ? 'SHORT' : 'FLAT';
          const size = Math.abs(activePos);
          const prev = this.positions.get(symbol);

          console.log(`\n${side === 'LONG' ? '🟢' : side === 'SHORT' ? '🔴' : '⚪'} [${new Date().toLocaleTimeString()}] ${symbol} ${side}`);
          console.log(`   Size: ${size} | Avg Price: ${parseFloat(pos.avg_price || 0).toFixed(6)}`);
          console.log(`   Leverage: ${pos.leverage}x | Liquidation: ${parseFloat(pos.liquidation_price || 0).toFixed(6)}`);

          const frData = this.fundingRates.get(symbol);
          if (frData) {
            console.log(`   Funding Rate: ${frData.rate.toFixed(4)}% → ${this.formatTimeRemaining(frData.timeRemaining)}`);
          }

          // Update position
          if (activePos === 0) {
            // Position closed
            this.positions.delete(symbol);
            console.log('   ✅ Position CLOSED');
          } else {
            // Position updated
            this.positions.set(symbol, { ...pos, symbol, side, size, positionAmount: activePos });
          }

          this.lastUpdate = Date.now();

          this.emit('position', {
            exchange: 'coindcx',
            type: prev ? 'update' : 'new',
            position: { ...pos, symbol, side, size, positionAmount: activePos },
            previous: prev
          });
        });

        console.log('');
      } catch (error) {
        console.error('❌ Error processing position update:', error.message);
      }
    });

    // Debug: Log other events (comment out in production)
    this.coindcxSocket.onAny((eventName, ...args) => {
      // Only log non-position events for debugging
      if (!eventName.includes('position') && !eventName.includes('cross')) {
        console.log(`📡 CoinDCX Event: "${eventName}"`);
      }
    });

    this.coindcxSocket.on('disconnect', (reason) => {
      console.log('❌ CoinDCX Private WS disconnected:', reason);
      setTimeout(() => this.connectCoinDCXPrivate(), 5000);
    });
  }

  // --- Connect Binance Public Funding Rate WS ---
  connectBinanceFunding() {
    console.log('🔌 Connecting to Binance Public Funding Stream (!markPrice@arr)...');
    this.binanceSocket = new WebSocket('wss://fstream.binance.com/stream?streams=!markPrice@arr');

    this.binanceSocket.on('open', () => {
      console.log('✅ Binance Funding WS connected\n');
    });

    this.binanceSocket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!msg.data || !Array.isArray(msg.data)) return;

        const now = Date.now();

        msg.data.forEach(update => {
          const binanceSymbol = update.s; // e.g., "SONICUSDT"
          const coindcxSymbol = this.binanceToCoinDCX(binanceSymbol); // Convert to "B-SONIC_USDT"

          // Only care about symbols we have positions in
          if (!this.positions.has(coindcxSymbol)) return;

          const rate = parseFloat(update.r) * 100; // to percent
          const nextFundingTime = update.T;

          this.fundingRates.set(coindcxSymbol, {
            rate,
            nextFundingTime,
            timeRemaining: nextFundingTime - now
          });

          console.log(`💰 Binance Funding | ${coindcxSymbol}: ${rate.toFixed(4)}% | Next: ${this.formatTimeRemaining(nextFundingTime - now)}`);

          this.emit('funding_rate', {
            symbol: coindcxSymbol,
            fundingRate: rate,
            nextFundingTime,
            timeRemaining: nextFundingTime - now
          });
        });
      } catch (err) {
        console.error('Binance message parse error:', err.message);
      }
    });

    this.binanceSocket.on('close', () => {
      console.log('❌ Binance Funding WS closed - reconnecting...');
      setTimeout(() => this.connectBinanceFunding(), 5000);
    });

    this.binanceSocket.on('error', (err) => {
      console.error('Binance WS error:', err.message);
    });
  }

  // --- Heartbeat / Status ---
  startStatusUpdates() {
    this.stopStatusUpdates();
    this.statusInterval = setInterval(() => {
      const time = new Date().toLocaleTimeString();
      let status = `\n💚 [${time}] CoinDCX Monitor Active | Messages: ${this.messageCount}`;

      if (this.lastUpdate) {
        const ago = Math.floor((Date.now() - this.lastUpdate) / 1000);
        status += ` | Last Update: ${ago}s ago`;
      }

      status += `\n   📊 Open Positions: ${this.positions.size}`;
      if (this.positions.size === 0) {
        status += '\n   No active positions';
      } else {
        this.positions.forEach((pos, symbol) => {
          const fr = this.fundingRates.get(symbol);
          const frText = fr ? `${fr.rate.toFixed(4)}% → ${this.formatTimeRemaining(fr.timeRemaining)}` : 'Loading...';
          const pnl = parseFloat(pos.unrealised_pnl || pos.unrealisedPnl || 0);
          const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
          status += `\n   ${pnlEmoji} ${symbol} ${pos.side} | Size: ${pos.size} | FR: ${frText}`;
        });
      }
      status += '\n';
      console.log(status);
    }, 15000);
  }

  stopStatusUpdates() {
    if (this.statusInterval) clearInterval(this.statusInterval);
  }

  // --- Public Getters ---
  getPositions() {
    return Array.from(this.positions.values());
  }

  getPosition(symbol) {
    return this.positions.get(symbol.toUpperCase());
  }

  getFundingRate(symbol) {
    return this.fundingRates.get(symbol.toUpperCase());
  }

  getAllFundingRates() {
    return Object.fromEntries(this.fundingRates);
  }

  // --- Start Everything ---
  async connect() {
    console.log('🚀 Starting CoinDCX Position + Binance Funding Monitor');
    console.log('='.repeat(70));

    this.connectCoinDCXPrivate();
    this.connectBinanceFunding();
    this.startStatusUpdates();
  }

  disconnect() {
    this.stopStatusUpdates();
    if (this.coindcxSocket) this.coindcxSocket.close();
    if (this.binanceSocket) this.binanceSocket.close();
    this.positions.clear();
    this.fundingRates.clear();
    console.log('🔌 CoinDCX Monitor stopped');
  }
}

export default CoinDCXPositionMonitor;