import crypto from "crypto";
import WebSocket from "ws";
import EventEmitter from "events";
import axios from "axios";
import https from "https";
import config from "../config/config.js";

const httpsAgent = new https.Agent({ family: 4 });

/**
 * Delta Position + Funding Rate Monitor
 * Fixed NTP parsing bug + removed UDP socket error
 * Now uses correct Unix seconds timestamp
 * Added server time sync for authentication
 */
class DeltaPositionMonitor extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.positions = new Map();
    this.normalizedCache = new Map();
    this.fundingRates = new Map();
    this.markPrices = new Map(); // Live mark prices from v2/ticker (updated every second)

    this.socketUrl = "wss://socket.india.delta.exchange";
    this.restBaseUrl = "https://api.india.delta.exchange";
    this.apiKey = config.orderPlace.delta.apiKey;
    this.apiSecret = config.orderPlace.delta.apiSecret;

    this.isConnected = false;
    this.isAuthenticated = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;

    this.messageCount = 0;
    this.lastUpdateReceived = null;
    this.statusInterval = null;
    this.timeOffset = 0; // Offset between local and server time
  }

  getNextFundingTime() {
    const now = Date.now();
    const fundingHoursUTC = [0, 8, 16];
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);

    for (const hour of fundingHoursUTC) {
      const candidate = new Date(today);
      candidate.setUTCHours(hour);
      if (candidate.getTime() > now) return candidate;
    }
    const next = new Date(today);
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0);
    return next;
  }

  formatTimeRemaining(ms) {
    if (ms <= 0) return "Now";
    const totalSeconds = Math.floor(ms / 1000);
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const s = String(totalSeconds % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  normalizePosition(pos) {
    const size = parseFloat(pos.size) || 0;
    const entryPrice = parseFloat(pos.entry_price) || 0;
    const markPrice = parseFloat(pos.mark_price) || 0;
    const unrealizedPnL = parseFloat(pos.unrealized_pnl) || 0;
    const margin = parseFloat(pos.margin) || 0;

    let unrealizedPnLPercent = 0;
    if (margin > 0) {
      unrealizedPnLPercent = (unrealizedPnL / margin) * 100;
    }

    const priceChange = markPrice - entryPrice;

    return {
      ...pos,
      product_symbol: pos.product_symbol || pos.symbol || "UNKNOWN",
      size,
      sizeAbs: Math.abs(size),
      side: size > 0 ? "LONG" : size < 0 ? "SHORT" : "FLAT",
      entry_price: entryPrice,
      mark_price: markPrice,
      unrealized_pnl: unrealizedPnL,
      unrealized_pnl_percent: unrealizedPnLPercent,
      price_change: priceChange,
    };
  }

  printCompactLiveUpdate(pos, prevPos = null) {
    const time = new Date().toLocaleTimeString();
    const pnlColor = pos.unrealized_pnl >= 0 ? "🟢" : "🔴";
    const trend = pos.price_change >= 0 ? "📈" : "📉";

    console.log(
      `   ${pnlColor} [${time}] ${pos.product_symbol} ` +
        `| Mark: ${pos.mark_price.toFixed(6)} ${trend} ` +
        `| PnL: ${pos.unrealized_pnl.toFixed(4)} USD (${pos.unrealized_pnl_percent.toFixed(2)}%)`,
    );

    if (prevPos) {
      const priceDiff = pos.mark_price - prevPos.mark_price;
      const pnlDiff = pos.unrealized_pnl - prevPos.unrealized_pnl;
      if (Math.abs(priceDiff) > 0.000001 || Math.abs(pnlDiff) > 0.000001) {
        const priceArrow = priceDiff >= 0 ? "↑" : "↓";
        const pnlArrow = pnlDiff >= 0 ? "↑" : "↓";
        console.log(
          `      ⚡ Change: Price ${priceArrow} ${Math.abs(priceDiff).toFixed(6)} | PnL ${pnlArrow} ${Math.abs(pnlDiff).toFixed(4)}`,
        );
      }
    }
    console.log("");
  }

  startStatusUpdates() {
    this.stopStatusUpdates();
    this.statusInterval = setInterval(() => {
      const now = Date.now();
      const secsSinceUpdate = this.lastUpdateReceived
        ? Math.floor((now - this.lastUpdateReceived) / 1000)
        : null;

      const time = new Date().toLocaleTimeString();
      let status = `\n💚 [${time}] Delta WS ${this.isAuthenticated ? "Authenticated" : "Connected (Auth Pending/Failed)"} | Msg: ${this.messageCount}`;

      if (secsSinceUpdate !== null) {
        status += ` | Last: ${secsSinceUpdate}s ago${secsSinceUpdate > 30 ? " (quiet)" : ""}`;
      }

      status += `\n   📊 Positions: ${this.positions.size}`;
      if (this.positions.size === 0) {
        status += `\n   ⚠️ No open positions detected`;
      } else {
        this.normalizedCache.forEach((pos) => {
          const pnlColor = pos.unrealized_pnl >= 0 ? "🟢" : "🔴";
          const frData = this.fundingRates.get(pos.product_symbol);
          const frText = frData
            ? `${(frData.rate * 100).toFixed(4)}% → ${this.formatTimeRemaining(frData.nextFundingTime - now)}`
            : "Loading...";
          status += `\n   ${pnlColor} ${pos.product_symbol}: ${pos.mark_price.toFixed(6)} | PnL ${pos.unrealized_pnl.toFixed(4)} (${pos.unrealized_pnl_percent.toFixed(2)}%) | FR: ${frText}`;
        });
      }
      status += "\n";
      console.log(status);
    }, 10000);
  }

  stopStatusUpdates() {
    if (this.statusInterval) clearInterval(this.statusInterval);
  }

  generateSignature(message) {
    return crypto
      .createHmac("sha256", this.apiSecret)
      .update(message)
      .digest("hex");
  }

  async syncServerTime() {
    // Try multiple endpoints to get server time
    const timeEndpoints = [
      "/v2/time",
      "/v1/time",
      "/time",
      "/v2/products", // Fallback: get products list which includes timestamp in headers
    ];

    for (const endpoint of timeEndpoints) {
      try {
        console.log(`🕐 Trying Delta time endpoint: ${endpoint}...`);
        const beforeRequest = Date.now();

        const response = await axios.get(`${this.restBaseUrl}${endpoint}`, {
          httpsAgent,
          timeout: 3000,
        });

        const afterRequest = Date.now();
        const requestLatency = Math.floor((afterRequest - beforeRequest) / 2);

        // Try to extract server time from response body
        let serverTimeSeconds = null;

        if (response.data) {
          // Try different response formats
          if (typeof response.data.result === "number") {
            serverTimeSeconds = response.data.result;
          } else if (typeof response.data.time === "number") {
            serverTimeSeconds = response.data.time;
          } else if (typeof response.data.timestamp === "number") {
            serverTimeSeconds = response.data.timestamp;
          } else if (typeof response.data === "number") {
            serverTimeSeconds = response.data;
          }
        }

        // If not in body, try response headers
        if (!serverTimeSeconds && response.headers) {
          const dateHeader = response.headers["date"];
          if (dateHeader) {
            serverTimeSeconds = Math.floor(
              new Date(dateHeader).getTime() / 1000,
            );
          }
        }

        if (serverTimeSeconds) {
          const serverTimeMs = serverTimeSeconds * 1000;
          const localTimeMs = beforeRequest + requestLatency;

          // Calculate offset in seconds
          const offsetMs = serverTimeMs - localTimeMs;
          this.timeOffset = Math.floor(offsetMs / 1000);

          console.log(`✅ Server time synced successfully (from ${endpoint})`);
          console.log(`   Local time: ${new Date(localTimeMs).toISOString()}`);
          console.log(
            `   Server time: ${new Date(serverTimeMs).toISOString()}`,
          );
          console.log(`   Offset: ${this.timeOffset}s (${offsetMs}ms)`);
          console.log(`   Latency: ~${requestLatency}ms\n`);

          return true;
        }
      } catch (error) {
        console.log(`   ⚠️ ${endpoint} failed: ${error.message}`);
        continue; // Try next endpoint
      }
    }

    // If all endpoints failed, use local time with warning
    console.warn("❌ Could not sync with Delta server time");
    console.warn(
      "⚠️ Using local system time (ensure system clock is accurate)\n",
    );
    this.timeOffset = 0;
    return false;
  }

  getAdjustedTimestamp() {
    return Math.floor(Date.now() / 1000) + this.timeOffset;
  }

  attemptAuthentication(retryCount = 0, maxRetries = 3) {
    // Get server-adjusted Unix timestamp in seconds (as number, not string)
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signaturePayload = "GET" + timestamp + "/live";
    const signature = this.generateSignature(signaturePayload);

    const authMessage = {
      type: "key-auth",
      payload: {
        "api-key": this.apiKey,
        timestamp: timestamp, // Must be number, not string
        signature,
      },
    };

    const timestampISO = new Date(timestamp * 1000).toISOString();
    const retryMsg =
      retryCount > 0 ? ` (Retry ${retryCount}/${maxRetries})` : "";
    console.log(`🔑 Authenticating with Delta...${retryMsg}`);
    console.log(`   Timestamp: ${timestamp} (${timestampISO})`);
    console.log(`   Adjusted Offset: ${this.timeOffset}s`);
    console.log(`   API Key: ${this.apiKey.substring(0, 8)}...`);
    console.log(`   Signature: ${signature.substring(0, 16)}...\n`);

    // Store retry info for auth failure handler
    this.authRetryCount = retryCount;
    this.authMaxRetries = maxRetries;

    this.ws.send(JSON.stringify(authMessage));
  }

  async connect() {
    console.log("🚀 Starting Delta Position + Funding Monitor");
    console.log("=".repeat(60));

    this.ws = new WebSocket(this.socketUrl, {
      family: 4,
    });

    this.ws.on("open", async () => {
      console.log("✅ Connected to Delta WebSocket\n");
      this.isConnected = true;
      this.reconnectAttempts = 0;

      // Sync server time right before authentication to minimize drift
      await this.syncServerTime();

      // Attempt authentication with retry logic
      this.attemptAuthentication();
    });

    this.ws.on("message", (raw) => {
      this.messageCount++;
      this.handleMessage(raw);
    });

    this.ws.on("close", () => {
      console.log("❌ WebSocket closed");
      this.isConnected = false;
      this.isAuthenticated = false;
      this.stopStatusUpdates();
      this.emit("reconnecting", { exchange: "delta" });
      this.handleReconnect();
    });

    this.ws.on("error", (err) => {
      console.error("⚠️ WS Error:", err.message);
    });

    this.startStatusUpdates();
  }

  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      console.error("❌ Parse error:", err.message);
      return;
    }

    // Ignore subscription confirmation messages
    if (msg.type === "subscriptions") {
      return;
    }

    if (msg.type === "key-auth") {
      if (msg.success) {
        console.log("✅ AUTHENTICATED SUCCESSFULLY!\n");
        this.isAuthenticated = true;

        this.ws.send(
          JSON.stringify({
            type: "subscribe",
            payload: { channels: [{ name: "positions", symbols: ["all"] }] },
          }),
        );
        console.log("📡 Subscribed to positions\n");

        // Subscribe to v2/ticker for funding rates (all symbols)
        this.ws.send(
          JSON.stringify({
            type: "subscribe",
            payload: { channels: [{ name: "v2/ticker", symbols: ["all"] }] },
          }),
        );
        console.log("📡 Subscribed to v2/ticker for funding rates\n");
        // setTimeout(async () => {
        //   console.log('🔄 Fetching initial positions via REST API for reliable sync...');
        //   await this.refreshPositions({product_id: 0}, 3, 3000);
        // }, 3000);
      } else {
        console.error("❌ AUTHENTICATION FAILED!");
        console.error("Details:", msg);

        // Retry authentication if within retry limit
        if (this.authRetryCount < this.authMaxRetries) {
          const nextRetry = this.authRetryCount + 1;
          console.log(
            `🔄 Retrying authentication in 2 seconds... (${nextRetry}/${this.authMaxRetries})\n`,
          );

          setTimeout(() => {
            this.attemptAuthentication(nextRetry, this.authMaxRetries);
          }, 2000);
        } else {
          console.error("❌ Authentication failed after maximum retries\n");
          this.emit("auth_failed", msg);
        }
      }
      return;
    }

    if (msg.type === "positions") {
      if (msg.action === "snapshot") {
        this.handleSnapshot(msg.result || []);
      } else if (msg.action === "update") {
        const updates = Array.isArray(msg.result)
          ? msg.result
          : msg.result
            ? [msg.result]
            : [];
        updates.forEach((pos) => this.handleUpdate(pos));
      }
      return;
    }

    // Handle v2/ticker messages (contains funding rate)
    if (msg.type === "v2/ticker") {
      const symbol = msg.symbol || msg.product_symbol;
      if (!symbol) return;

      // Funding rate comes as decimal (e.g., 0.0001 = 0.01%)
      const rate = parseFloat(msg.funding_rate);

      // Cache live mark price from ticker (available on every v2/ticker message)
      const tickerMarkPrice = parseFloat(msg.mark_price);
      if (!isNaN(tickerMarkPrice) && tickerMarkPrice > 0) {
        this.markPrices.set(symbol, tickerMarkPrice);
      }

      // Skip funding rate processing if funding rate is null/undefined/NaN
      if (rate === null || rate === undefined || isNaN(rate)) {
        return;
      }

      const nextFundingTime = this.getNextFundingTime();

      this.fundingRates.set(symbol, {
        rate,
        nextFundingTime,
      });

      // Only log if we have an open position in this symbol
      const hasPosition = Array.from(this.positions.values()).some(
        (p) =>
          p.product_symbol === symbol ||
          p.product_symbol?.toUpperCase() === symbol.toUpperCase(),
      );

      if (hasPosition) {
        console.log(
          `💰 Delta Funding | ${symbol}: ${rate.toFixed(4)}% | Next: ${this.formatTimeRemaining(nextFundingTime - Date.now())}`,
        );
      }

      this.emit("funding_rate", { symbol, fundingRate: rate, nextFundingTime });
    }
  }

  handleSnapshot(data) {
    this.positions.clear();
    this.normalizedCache.clear();

    if (data.length === 0) {
      console.log("⚠️ No open positions on Delta Exchange\n");
      this.emit("snapshot", { positions: [], count: 0 });
      return;
    }

    console.log(`✅ Found ${data.length} open position(s)\n`);

    data.forEach((pos) => {
      pos.product_symbol = pos.product_symbol || pos.symbol;
      const normalized = this.normalizePosition(pos);
      console.log(`   📍 Position Symbol: ${normalized.product_symbol}`);
      this.printCompactLiveUpdate(normalized);
      this.positions.set(pos.product_id, pos);
      this.normalizedCache.set(pos.product_id, normalized);
      this.emit("position", {
        exchange: "delta",
        type: "snapshot",
        position: normalized,
      });
    });

    this.emit("snapshot", {
      positions: Array.from(this.normalizedCache.values()),
      count: data.length,
    });

    // ⚠️ FLAG: Snapshot on reconnect may contain stale cached data
    // Notify TradeMonitor to force REST verification on next check
    this.emit("snapshot_received", {
      exchange: "delta",
      positionCount: data.length,
      warningFlag: "POTENTIAL_STALE_DATA_ON_RECONNECT",
    });
  }

  handleUpdate(pos) {
    this.lastUpdateReceived = Date.now();
    pos.product_symbol = pos.product_symbol || pos.symbol;

    const previousNorm = this.normalizedCache.get(pos.product_id);
    const normalized = this.normalizePosition(pos);

    if (normalized.size === 0) {
      console.log(`🚪 Position Closed: ${normalized.product_symbol}\n`);
      this.positions.delete(pos.product_id);
      this.normalizedCache.delete(pos.product_id);
      this.emit("position", {
        exchange: "delta",
        type: "closed",
        position: normalized,
      });
      return;
    }

    const hasChange =
      !previousNorm ||
      Math.abs(normalized.mark_price - previousNorm.mark_price) > 0.000001 ||
      Math.abs(normalized.unrealized_pnl - previousNorm.unrealized_pnl) >
        0.000001;

    if (hasChange) {
      console.log(`\n🔄 LIVE UPDATE [${new Date().toLocaleTimeString()}]`);
      this.printCompactLiveUpdate(normalized, previousNorm);
    }

    this.positions.set(pos.product_id, pos);
    this.normalizedCache.set(pos.product_id, normalized);
    this.emit("position", {
      exchange: "delta",
      type: "update",
      position: normalized,
    });
  }

  getPositions() {
    return Array.from(this.normalizedCache.values());
  }

  /** Returns the latest live mark price for a symbol from v2/ticker stream */
  getMarkPrice(symbol) {
    if (!symbol) return null;
    return (
      this.markPrices.get(symbol) ??
      this.markPrices.get(symbol.toUpperCase()) ??
      null
    );
  }

  getPositionBySymbol(symbol) {
    return this.getPositions().find((p) => p.product_symbol === symbol);
  }

  /**
   * Refresh positions via REST API (call after order execution)
   * This ensures we have the latest position data when WebSocket updates are delayed
   * @param {number} maxRetries - Maximum number of retry attempts
   * @param {number} retryDelay - Delay between retries in milliseconds
   */
  async refreshPositions(data, maxRetries = 3, retryDelay = 3000) {
    console.log("🔄 Forcing WebSocket re-authentication and full sync...\n");

    // Step 1: Close current connection if open
    if (this.ws) {
      console.log("   Closing existing WebSocket...");
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.isAuthenticated = false;
    this.positions.clear();
    this.normalizedCache.clear();
    this.fundingRates.clear();
    this.messageCount = 0;
    this.lastUpdateReceived = null;

    // Step 2: Reconnect and force re-authentication
    console.log("   Reconnecting WebSocket...");
    this.connect();

    try {
      const { default: deltaAPI } = await import("../services/deltaAPI.js");
      const restPositions = await deltaAPI.getPositions(data.product_id);
      console.log(
        `   REST fallback: ${restPositions?.length || 0} positions found`,
      );
    } catch (error) {
      console.warn(
        "   REST fallback failed (expected if rate-limited):",
        error.message,
      );
    }

    console.log("✅ WebSocket re-authentication initiated\n");

    // Import deltaAPI dynamically to avoid circular dependency
    // const { default: deltaAPI } = await import('../services/deltaAPI.js');

    // for (let attempt = 1; attempt <= maxRetries; attempt++) {
    //   try {
    //     console.log(`🔄 [Attempt ${attempt}/${maxRetries}] Refreshing Delta positions via REST API...`);

    //     const positions = await deltaAPI.getPositions(data.product_id);

    //     if (!positions || positions.length === 0) {
    //       console.log(`   No positions found via REST API (attempt ${attempt}/${maxRetries})`);

    //       // If this is not the last attempt, wait and retry
    //       if (attempt < maxRetries) {
    //         console.log(`   Retrying in ${retryDelay / 1000} seconds...\n`);
    //         await new Promise(resolve => setTimeout(resolve, retryDelay));
    //         continue;
    //       } else {
    //         console.log('   ⚠️ No positions found after all retry attempts\n');
    //         return;
    //       }
    //     }

    //     // Success - positions found!
    //     console.log(`   ✅ Found ${positions.length} position(s) via REST API\n`);

    //     positions.forEach(pos => {
    //       pos.product_symbol = pos.product_symbol || pos.symbol;
    //       const normalized = this.normalizePosition(pos);

    //       console.log(`   📍 Refreshed Position: ${normalized.product_symbol}`);
    //       this.printCompactLiveUpdate(normalized);

    //       this.positions.set(pos.product_id, pos);
    //       this.normalizedCache.set(pos.product_id, normalized);
    //       this.emit('position', { exchange: 'delta', type: 'refresh', position: normalized });
    //     });

    //     console.log('✅ Delta positions refreshed successfully\n');
    //     return; // Success - exit retry loop

    //   } catch (error) {
    //     console.error(`❌ Error refreshing Delta positions (attempt ${attempt}/${maxRetries}):`, error.message);

    //     // If this is not the last attempt, wait and retry
    //     if (attempt < maxRetries) {
    //       console.log(`   Retrying in ${retryDelay / 1000} seconds...\n`);
    //       await new Promise(resolve => setTimeout(resolve, retryDelay));
    //     } else {
    //       console.error('❌ Failed to refresh positions after all retry attempts\n');
    //     }
    //   }
    // }
  }

  getFundingRate(symbol) {
    // Try exact match first
    let result = this.fundingRates.get(symbol);

    // If not found, try case-insensitive match
    if (!result) {
      const upperSymbol = symbol?.toUpperCase();
      for (const [key, value] of this.fundingRates.entries()) {
        if (key.toUpperCase() === upperSymbol) {
          result = value;
          break;
        }
      }
    }

    // Debug logging
    if (!result) {
      console.log(`⚠️ Funding rate not found for symbol: ${symbol}`);
      console.log(
        `   Available symbols: ${Array.from(this.fundingRates.keys()).join(", ")}`,
      );
    }

    return result;
  }

  handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("❌ Max reconnects reached");
      return;
    }
    this.reconnectAttempts++;
    console.log(`🔄 Reconnecting in ${this.reconnectDelay / 1000}s...`);
    setTimeout(() => this.connect(), this.reconnectDelay);
  }

  disconnect() {
    this.stopStatusUpdates();
    if (this.ws) this.ws.close();
    console.log("🔌 Delta Monitor disconnected");
  }
}

export default DeltaPositionMonitor;
