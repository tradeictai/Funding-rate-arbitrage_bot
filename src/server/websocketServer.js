import { Server } from "socket.io";
import http from "http";

/**
 * WebSocket Server for Frontend Dashboard
 * Bridges backend events to frontend real-time updates
 */
class WebSocketServer {
  constructor(arbitrageEngine) {
    this.engine = arbitrageEngine;
    this.server = null;
    this.io = null;
    this.connectedClients = 0;
  }

  start(port = 5003) {
    console.log("\n🚀 Starting WebSocket Server for Dashboard...");
    console.log("=".repeat(60));

    // Create HTTP server for Socket.IO
    this.server = http.createServer();

    // Initialize Socket.IO with CORS
    this.io = new Server(this.server, {
      cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    // Setup event handlers
    this.setupEventHandlers();

    // Start listening
    this.server.listen(port, () => {
      console.log(`✅ WebSocket server running on port ${port}`);
      console.log(`📊 Dashboard URL: http://localhost:3000`);
      console.log("=".repeat(60));
    });
  }

  setupEventHandlers() {
    // ==========================================
    // 1. FUNDING RATE UPDATES (Live Monitoring)
    // ==========================================

    // Delta Exchange funding rates
    this.engine.deltaExchange.on("update", (data) => {
      // console.log('📡 Dashboard: Delta funding rate update ->', data);
      this.io.emit("fundingRate:delta", {
        symbol: data.symbol,
        fundingRate: data.fundingRate,
        markPrice: data.markPrice,
        nextFundingTime: data.nextFundingTime,
        timestamp: Date.now(),
      });
    });

    // Pi42 Exchange funding rates
    this.engine.coindcxExchange.on("update", (data) => {
      // console.log('📡 Dashboard: Coindcx funding rate update ->', data);
      this.io.emit("fundingRate:coindcx", {
        symbol: data.symbol,
        fundingRate: data.fundingRate,
        markPrice: data.markPrice,
        nextFundingTime: data.nextFundingTime,
        timestamp: Date.now(),
      });
    });

    // ==========================================
    // 2. OPPORTUNITY DETECTION
    // ==========================================

    this.engine.on("opportunity", (opportunity) => {
      // console.log('📊 Dashboard: Opportunity detected ->', opportunity);

      this.io.emit("opportunity:detected", {
        token: opportunity.token,
        pi42Symbol: opportunity.pi42Symbol,
        FR_delta: opportunity.FR_delta,
        FR_pi42: opportunity.FR_pi42,
        fundingDiff: opportunity.fundingDiff,
        threshold: opportunity.threshold,
        thresholdType: opportunity.thresholdType,
        FT_delta: opportunity.FT_delta,
        FT_pi42: opportunity.FT_pi42,
        price_delta: opportunity.price_delta,
        price_pi42: opportunity.price_pi42,
        timestamp: opportunity.timestamp,
      });
    });

    // ==========================================
    // 3. ORDER EXECUTION
    // ==========================================

    this.engine.on("decision", (decision) => {
      // console.log("Deceiwesion", decision)
      if (
        decision.decision === "EXECUTED" &&
        decision.executionResult?.success
      ) {
        console.log(
          "✅ Dashboard: Order executed ->",
          decision.opportunity.token
        );

        const opp = decision.opportunity;
        const exec = decision.executionResult;

        this.io.emit("order:executed", {
          token: opp.token,
          deltaSymbol: opp.token,
          coindcxSymbol: opp.coindcxSymbol,
          deltaSide: exec.deltaOrder.side,
          coindcxSide: exec.coindcxOrder.side,
          deltaOrderId: exec.deltaOrder.orderId,
          coindcxOrderId: exec.coindcxOrder.orderId,
          entryTime: Date.now(),
          fundingDiff: opp.fundingDiff,
          nextFundingTime: opp.FT_pi42,
        });
      }
    });

    // ==========================================
    // 4. POSITION MONITORING (Real-time)
    // ==========================================

    if (this.engine.tradeMonitor) {
      // Delta position updates
      this.engine.tradeMonitor.deltaMonitor.on("position", (data) => {
        // console.log('📡 Dashboard: Delta position update ->', data);
        if (data.type === "update" || data.type === "snapshot") {
          this.io.emit("position:update", {
            exchange: "delta",
            token: data.position.product_symbol,
            position: {
              product_symbol: data.position.product_symbol,
              product_id: data.position.product_id,
              size: data.position.size,
              entry_price: data.position.entry_price,
              mark_price: data.position.mark_price,
              unrealized_pnl: data.position.unrealized_pnl,
              margin: data.position.margin,
              product: data.position.product,
            },
          });
        }
      });

      // Pi42 position updates
      this.engine.tradeMonitor.coindcxMonitor.on("position", (data) => {
        // console.log('📡 Dashboard: Delta position update ->', data);
        if (
          data.type === "update" ||
          data.type === "snapshot" ||
          data.type === "new"
        ) {
          this.io.emit("position:update", {
            exchange: "coindcx",
            token: data.position.symbol || data.position.contractPair,
            position: {
              symbol: data.position.symbol,
              contractPair: data.position.contractPair,
              positionId: data.position.positionId,
              positionAmount: data.position.positionAmount,
              positionType: data.position.positionType,
              entryPrice: data.position.entryPrice,
              markPrice: data.position.markPrice,
              unrealisedPnl: data.position.unrealisedPnl,
              quantity: data.position.quantity,
            },
          });
        }
      });

      // ==========================================
      // 5. QUANTITY MISMATCH ALERTS
      // ==========================================

      this.engine.tradeMonitor.on("quantityMismatch", (data) => {
        console.log("⚠️  Dashboard: Quantity mismatch alert");

        this.io.emit("alert:quantityMismatch", {
          timestamp: Date.now(),
          reason: `Quantity mismatch: Delta ${data.deltaQty?.toFixed(
            4
          )} vs Coindcx ${data.coindcxQty?.toFixed(4)}`,
          details: {
            deltaQuantity: data.deltaQty,
            coindcxQuantity: data.coindcxQty,
            qtyDiffPct: data.differencePct,
          },
        });
      });

      // ==========================================
      // 6. FLIP DETECTION ALERTS
      // ==========================================

      this.engine.tradeMonitor.on("flip", (data) => {
        console.log("⚠️  Dashboard: Flip detection alert");

        this.io.emit("alert:flip", {
          timestamp: Date.now(),
          reason: `Funding flip: ${data.diff?.toFixed(4)}% < threshold ${
            data.threshold
          }%`,
          details: {
            currentDiff: data.diff,
            threshold: data.threshold,
            deltaFR: data.FR_delta,
            coindcxFR: data.FR_coindcx,
          },
        });
      });

      // ==========================================
      // 7. EMERGENCY EXIT
      // ==========================================

      this.engine.tradeMonitor.on("emergencyExit", (exitData) => {
        console.log("🚨 Dashboard: Emergency exit triggered");

        this.io.emit("alert:emergencyExit", {
          timestamp: Date.now(),
          reason: exitData.reason,
          details: exitData.details,
        });
      });

      // ==========================================
      // 8. NORMAL EXIT
      // ==========================================

      this.engine.tradeMonitor.on("normalExit", (exitData) => {
        console.log("✅ Dashboard: Normal exit initiated");

        this.io.emit("position:closed", {
          timestamp: Date.now(),
          token: exitData.deltaPosition?.product_symbol,
          exitType: "normal",
          reason: exitData.reason,
        });
      });
    }

    // ==========================================
    // CLIENT CONNECTION HANDLING
    // ==========================================

    this.io.on("connection", (socket) => {
      this.connectedClients++;
      console.log(`\n✅ Dashboard connected: ${socket.id}`);
      console.log(`   Total clients: ${this.connectedClients}\n`);

      // Send welcome message
      socket.emit("connected", {
        message: "Connected to arbitrage bot backend",
        timestamp: Date.now(),
        version: "1.0.0",
      });

      // Handle disconnection
      socket.on("disconnect", () => {
        this.connectedClients--;
        console.log(`\n❌ Dashboard disconnected: ${socket.id}`);
        console.log(`   Total clients: ${this.connectedClients}\n`);
      });

      // Handle errors
      socket.on("error", (error) => {
        console.error("⚠️  Socket error:", error.message);
      });
    });
  }

  stop() {
    if (this.io) {
      this.io.close();
    }
    if (this.server) {
      this.server.close();
      console.log("🛑 WebSocket server stopped");
    }
  }
}

export default WebSocketServer;
