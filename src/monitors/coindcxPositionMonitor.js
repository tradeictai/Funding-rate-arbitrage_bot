import io from "socket.io-client";
import { WebSocket } from "ws";
import crypto from "crypto";
import EventEmitter from "events";
import config from "../config/config.js";
import coindcxAPI from "../services/coindcxAPI.js";

/**
 * CoinDCX Position + Binance Funding Rate Monitor
 * - Private CoinDCX WS: Real-time position updates
 * - Public Binance WS: Accurate funding rates & countdown
 * - Only tracks symbols you have open positions in
 */
class CoinDCXPositionMonitor extends EventEmitter {
  constructor() {
    super();
    this.coindcxSocket = null; // Private authenticated socket
    this.binanceSocket = null; // Public funding rate socket
    this.positions = new Map(); // symbol -> position data (CoinDCX format)
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
    const converted = binanceSymbol.replace(/(USDT|USDC|BUSD)$/, "_$1");
    return `B-${converted}`;
  }

  // CoinDCX: B-SONIC_USDT → Binance: SONICUSDT
  coindcxToBinance(coindcxSymbol) {
    // Remove B- prefix and underscore
    return coindcxSymbol.replace(/^B-/, "").replace("_", "");
  }

  // --- Binance Next Funding Time (every 8h: 00:00, 08:00, 16:00 UTC) ---
  formatTimeRemaining(ms) {
    if (ms <= 0) return "Now!";
    const totalSeconds = Math.floor(ms / 1000);
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const s = String(totalSeconds % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  // --- Generate CoinDCX Auth Signature ---
  generateSignature() {
    const body = { channel: "coindcx" };
    const payload = Buffer.from(JSON.stringify(body)).toString(); // Critical format
    return crypto
      .createHmac("sha256", this.apiSecret)
      .update(payload)
      .digest("hex");
  }

  // --- Fetch Initial Positions via REST API ---
  async fetchInitialPositions() {
    try {
      const positions = await coindcxAPI.getPositions();
      console.log("get postions: ", positions);
      console.log(`✅ Fetched ${positions.length} existing position(s)\n`);

      if (positions.length === 0) {
        console.log("   No active positions found\n");
        return;
      }

      // Process each existing position
      for (const pos of positions) {
        const symbol = pos.pair?.toUpperCase();
        if (!symbol) continue;

        const activePos = parseFloat(pos.active_pos || 0);
        if (activePos === 0) continue; // Skip flat positions

        const side = activePos > 0 ? "LONG" : "SHORT";
        const size = Math.abs(activePos);

        // Get unrealized PnL
        let unrealizedPnl = parseFloat(
          pos.unrealised_pnl || pos.unrealisedPnl || pos.pnl || 0,
        );

        // If REST API doesn't provide unrealized PnL, calculate it
        if (!pos.unrealised_pnl && !pos.unrealisedPnl && !pos.pnl) {
          console.log(
            `   ⚠️ REST API missing unrealized PnL, calculating manually...`,
          );
          unrealizedPnl = await this.calculateUnrealizedPnL(pos);
        }

        // Convert to Binance symbol for debugging
        const binanceSymbol = this.coindcxToBinance(symbol);
        console.log(
          `\n${side === "LONG" ? "🟢" : "🔴"} [${new Date().toLocaleTimeString()}] ${symbol} ${side}`,
        );
        console.log(
          `   Size: ${size} | Avg Price: ${parseFloat(pos.avg_price || 0).toFixed(6)}`,
        );
        console.log(
          `   Leverage: ${pos.leverage}x | Margin: ${pos.margin_type}`,
        );
        console.log(`   💰 Unrealized PnL: $${unrealizedPnl.toFixed(4)}`);
        console.log(`   Binance Symbol: ${binanceSymbol} (for funding rate)`);

        // Enhanced position object with unrealized PnL
        const enhancedPosition = {
          ...pos,
          symbol,
          side,
          size,
          positionAmount: activePos,
          unrealised_pnl: unrealizedPnl,
          unrealisedPnl: unrealizedPnl,
          pnl: unrealizedPnl,
        };

        // Store position
        this.positions.set(symbol, enhancedPosition);
        this.lastUpdate = Date.now();

        // Emit position event
        this.emit("position", {
          exchange: "coindcx",
          type: "snapshot",
          position: enhancedPosition,
          previous: null,
        });
      }

      console.log("");
    } catch (error) {
      console.error("❌ Error fetching initial positions:", error.message);
    }
  }

  // --- Connect CoinDCX Private WS (Positions) ---
  connectCoinDCXPrivate() {
    console.log("🔌 Connecting to CoinDCX Private WebSocket...");
    this.coindcxSocket = io("wss://stream.coindcx.com", {
      transports: ["websocket"],
    });

    this.coindcxSocket.on("connect", () => {
      console.log("✅ CoinDCX Private WS connected");
      const signature = this.generateSignature();
      this.coindcxSocket.emit("join", {
        channelName: "coindcx",
        authSignature: signature,
        apiKey: this.apiKey,
      });
      console.log("📡 Authenticated to private channel");

      // Fetch initial positions via REST API (WebSocket only provides updates)
      setTimeout(async () => {
        console.log("📡 Fetching initial positions via REST API...");
        await this.fetchInitialPositions();
      }, 1000);
    });

    // POSITION UPDATES (Real-time via WebSocket)
    // Per CoinDCX docs: response.data contains array of position objects
    // Trying multiple event names to find the correct one
    const positionEventNames = [
      "df-user-cross-position-details", // Cross margin positions
      "df-position-update", // General position update
      "df-user-isolated-position-details", // Isolated margin positions
      "position-update",
      "user-position-update",
    ];

    positionEventNames.forEach((eventName) => {
      this.coindcxSocket.on(eventName, async (response) => {
        try {
          this.messageCount++;

          console.log(
            `\n🔄 Position Update Received from event: "${eventName}"`,
          );
          console.log("Response:", JSON.stringify(response, null, 2));
          console.log(
            "📋 DEBUG: Full WebSocket position data fields:",
            response.data ? Object.keys(response.data[0] || {}) : "No data",
          );

          // Extract position data (docs show response.data is the array)
          const positions = Array.isArray(response.data)
            ? response.data
            : response.data
              ? [response.data]
              : [];

          console.log("CoinDCX position ke andar:", positions);

          if (positions.length === 0) {
            console.log("⚠️ Empty position update\n");
            return;
          }

          // Process each position with unrealized PnL
          for (const pos of positions) {
            const symbol = pos.pair?.toUpperCase();
            if (!symbol) continue;

            const activePos = parseFloat(pos.active_pos || 0);
            const side =
              activePos > 0 ? "LONG" : activePos < 0 ? "SHORT" : "FLAT";
            const size = Math.abs(activePos);
            const prev = this.positions.get(symbol);

            // Calculate unrealized PnL if not provided
            let unrealizedPnl = parseFloat(
              pos.unrealised_pnl || pos.unrealisedPnl || pos.pnl || 0,
            );

            // If WebSocket doesn't provide unrealized PnL, calculate it manually
            if (!pos.unrealised_pnl && !pos.unrealisedPnl && !pos.pnl) {
              console.log(
                `⚠️ WebSocket data missing unrealized PnL, calculating manually...`,
              );
              unrealizedPnl = await this.calculateUnrealizedPnL(pos);
            }

            console.log(
              `\n${side === "LONG" ? "🟢" : side === "SHORT" ? "🔴" : "⚪"} [${new Date().toLocaleTimeString()}] ${symbol} ${side}`,
            );
            console.log(
              `   Size: ${size} | Avg Price: ${parseFloat(pos.avg_price || 0).toFixed(6)}`,
            );
            console.log(
              `   Leverage: ${pos.leverage}x | Liquidation: ${parseFloat(pos.liquidation_price || 0).toFixed(6)}`,
            );
            console.log(`   💰 Unrealized PnL: $${unrealizedPnl.toFixed(4)}`);

            const frData = this.fundingRates.get(symbol);
            if (frData) {
              console.log(
                `   Funding Rate: ${frData.rate.toFixed(4)}% → ${this.formatTimeRemaining(frData.timeRemaining)}`,
              );
            }

            // Enhanced position object with unrealized PnL
            const enhancedPosition = {
              ...pos,
              symbol,
              side,
              size,
              positionAmount: activePos,
              unrealised_pnl: unrealizedPnl,
              unrealisedPnl: unrealizedPnl, // Duplicate for compatibility
              pnl: unrealizedPnl,
            };

            // Update position
            if (activePos === 0) {
              // Position closed
              this.positions.delete(symbol);
              console.log("   ✅ Position CLOSED");
            } else {
              // Position updated
              this.positions.set(symbol, enhancedPosition);
            }

            this.lastUpdate = Date.now();

            this.emit("position", {
              exchange: "coindcx",
              type: prev ? "update" : "new",
              position: enhancedPosition,
              previous: prev,
            });
          }

          console.log("");
        } catch (error) {
          console.error("❌ Error processing position update:", error.message);
          console.error("Stack:", error.stack);
        }
      });
    });

    // Debug: Log ALL events to find the correct position update event
    this.coindcxSocket.onAny((eventName, ...args) => {
      console.log(`📡 CoinDCX Event: "${eventName}"`);

      // If it's a potential position event, log the full data
      if (
        eventName.includes("position") ||
        eventName.includes("cross") ||
        eventName.includes("isolated") ||
        eventName.includes("user")
      ) {
        console.log(
          `   └─ Data:`,
          JSON.stringify(args[0], null, 2).substring(0, 500),
        );
      }
    });

    this.coindcxSocket.on("disconnect", (reason) => {
      console.log("❌ CoinDCX Private WS disconnected:", reason);
      setTimeout(() => this.connectCoinDCXPrivate(), 5000);
    });
  }

  // --- Connect Binance Public Funding Rate WS ---
  connectBinanceFunding() {
    console.log(
      "🔌 Connecting to Binance Public Funding Stream (!markPrice@arr)...",
    );
    this.binanceSocket = new WebSocket(
      "wss://fstream.binance.com/stream?streams=!markPrice@arr",
    );

    this.binanceSocket.on("open", () => {
      console.log("✅ Binance Funding WS connected\n");
    });

    this.binanceSocket.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!msg.data || !Array.isArray(msg.data)) return;

        const now = Date.now();

        msg.data.forEach((update) => {
          const binanceSymbol = update.s; // e.g., "SONICUSDT"
          const coindcxSymbol = this.binanceToCoinDCX(binanceSymbol); // Convert to "B-SONIC_USDT"

          // Only care about symbols we have positions in
          if (!this.positions.has(coindcxSymbol)) return;

          const rate = parseFloat(update.r) * 100; // to percent
          const nextFundingTime = update.T;

          this.fundingRates.set(coindcxSymbol, {
            rate,
            nextFundingTime,
            timeRemaining: nextFundingTime - now,
          });

          console.log(
            `💰 Binance Funding | ${coindcxSymbol}: ${rate.toFixed(4)}% | Next: ${this.formatTimeRemaining(nextFundingTime - now)}`,
          );

          this.emit("funding_rate", {
            symbol: coindcxSymbol,
            fundingRate: rate,
            nextFundingTime,
            timeRemaining: nextFundingTime - now,
          });
        });
      } catch (err) {
        console.error("Binance message parse error:", err.message);
      }
    });

    this.binanceSocket.on("close", () => {
      console.log("❌ Binance Funding WS closed - reconnecting...");
      setTimeout(() => this.connectBinanceFunding(), 5000);
    });

    this.binanceSocket.on("error", (err) => {
      console.error("Binance WS error:", err.message);
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

      console.log("wetw", this.positions);

      status += `\n   📊 Open Positions: ${this.positions.size}`;
      if (this.positions.size === 0) {
        status += "\n   No active positions";
      } else {
        this.positions.forEach((pos, symbol) => {
          const fr = this.fundingRates.get(symbol);
          const frText = fr
            ? `${fr.rate.toFixed(4)}% → ${this.formatTimeRemaining(fr.timeRemaining)}`
            : "Loading...";
          const pnl = parseFloat(pos.unrealised_pnl || pos.unrealisedPnl || 0);
          const pnlEmoji = pnl >= 0 ? "🟢" : "🔴";
          status += `\n   ${pnlEmoji} ${symbol} ${pos.side} | Size: ${pos.size} | FR: ${frText}`;
        });
      }
      status += "\n";
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
    if (!symbol) {
      console.warn("⚠️ getFundingRate called with undefined symbol");
      return null;
    }
    return this.fundingRates.get(symbol.toUpperCase());
  }

  getAllFundingRates() {
    return Object.fromEntries(this.fundingRates);
  }

  /**
   * Calculate unrealized PnL for a position
   * Fetches current mark price from Binance and calculates PnL
   * @param {Object} position - Position object from CoinDCX
   * @returns {Promise<number>} - Unrealized PnL in USDT
   */
  async calculateUnrealizedPnL(position) {
    try {
      const symbol = position.pair?.toUpperCase();
      if (!symbol) return 0;

      const binanceSymbol = this.coindcxToBinance(symbol);

      // Get mark price from Binance
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${binanceSymbol}`,
      );
      const data = await response.json();

      if (!data || !data.markPrice) {
        console.log(`   ⚠️ Could not fetch mark price for ${binanceSymbol}`);
        return 0;
      }

      const markPrice = parseFloat(data.markPrice);
      const avgPrice = parseFloat(position.avg_price || 0);
      const activePos = parseFloat(position.active_pos || 0);
      const size = Math.abs(activePos);

      // Calculate PnL based on position side
      let pnl = 0;
      if (activePos > 0) {
        // LONG position: PnL = (Mark Price - Entry Price) * Size
        pnl = (markPrice - avgPrice) * size;
      } else if (activePos < 0) {
        // SHORT position: PnL = (Entry Price - Mark Price) * Size
        pnl = (avgPrice - markPrice) * size;
      }

      console.log(
        `   💰 Calculated PnL: $${pnl.toFixed(4)} (Mark: ${markPrice}, Entry: ${avgPrice}, Size: ${size})`,
      );

      return Number(pnl.toFixed(4));
    } catch (error) {
      console.error(`   ❌ Error calculating unrealized PnL:`, error.message);
      return 0;
    }
  }

  /**
   * Refresh positions via REST API (call after order execution)
   * This ensures we have the latest position data when WebSocket updates are delayed
   * @param {number} maxRetries - Maximum number of retry attempts
   * @param {number} retryDelay - Delay between retries in milliseconds
   */
  async refreshPositions(maxRetries = 3, retryDelay = 3000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `🔄 [Attempt ${attempt}/${maxRetries}] Refreshing CoinDCX positions via REST API...`,
        );

        const positions = await coindcxAPI.getPositions();

        if (!positions || positions.length === 0) {
          console.log(
            `   No positions found via REST API (attempt ${attempt}/${maxRetries})`,
          );

          // If this is not the last attempt, wait and retry
          if (attempt < maxRetries) {
            console.log(`   Retrying in ${retryDelay / 1000} seconds...\n`);
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            continue;
          } else {
            console.log("   ⚠️ No positions found after all retry attempts\n");
            return;
          }
        }

        // Success - positions found!
        console.log(
          `   ✅ Found ${positions.length} position(s) via REST API\n`,
        );

        // Process each position
        for (const pos of positions) {
          const symbol = pos.pair?.toUpperCase();
          if (!symbol) continue;

          const activePos = parseFloat(pos.active_pos || 0);
          if (activePos === 0) continue; // Skip flat positions

          const side = activePos > 0 ? "LONG" : "SHORT";
          const size = Math.abs(activePos);

          // Get unrealized PnL
          let unrealizedPnl = parseFloat(
            pos.unrealised_pnl || pos.unrealisedPnl || pos.pnl || 0,
          );

          // If REST API doesn't provide unrealized PnL, calculate it
          if (!pos.unrealised_pnl && !pos.unrealisedPnl && !pos.pnl) {
            unrealizedPnl = await this.calculateUnrealizedPnL(pos);
          }

          console.log(
            `   📍 Refreshed Position: ${symbol} ${side} | Size: ${size} | PnL: $${unrealizedPnl.toFixed(4)}`,
          );

          // Enhanced position object with unrealized PnL
          const enhancedPosition = {
            ...pos,
            symbol,
            side,
            size,
            positionAmount: activePos,
            unrealised_pnl: unrealizedPnl,
            unrealisedPnl: unrealizedPnl,
            pnl: unrealizedPnl,
          };

          // Store position
          this.positions.set(symbol, enhancedPosition);
          this.lastUpdate = Date.now();

          // Emit position event
          this.emit("position", {
            exchange: "coindcx",
            type: "refresh",
            position: enhancedPosition,
            previous: null,
          });
        }

        console.log("✅ CoinDCX positions refreshed successfully\n");
        return; // Success - exit retry loop
      } catch (error) {
        console.error(
          `❌ Error refreshing CoinDCX positions (attempt ${attempt}/${maxRetries}):`,
          error.message,
        );

        // If this is not the last attempt, wait and retry
        if (attempt < maxRetries) {
          console.log(`   Retrying in ${retryDelay / 1000} seconds...\n`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        } else {
          console.error(
            "❌ Failed to refresh positions after all retry attempts\n",
          );
        }
      }
    }
  }

  // --- Start Everything ---
  async connect() {
    console.log("🚀 Starting CoinDCX Position + Binance Funding Monitor");
    console.log("=".repeat(70));

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
    console.log("🔌 CoinDCX Monitor stopped");
  }
}

export default CoinDCXPositionMonitor;
