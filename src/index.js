import ArbitrageEngine from "./core/arbitrageEngine.js";
import WebSocketServer from "./server/websocketServer.js";
import APIServer from "./server/apiServer.js";
import { loadConfigFromDB } from "./config/configLoader.js";

/**
 * Main Entry Point for Funding Rate Arbitrage System
 * Phase 1: Token Selection & Timing
 * Phase 2: Position Sizing, Liquidity & Profit Analysis
 * Phase 3: Order Execution on Both Exchanges
 * Dashboard: Real-time WebSocket server for frontend
 * API: REST API for configuration management
 */

async function main() {
  console.clear();
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   CEX Funding Rate Arbitrage - Phase 1, 2 & 3              ║");
  console.log("║   Delta Exchange ⇄ CoinDcx                                ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");

  // Load configuration from MongoDB
  console.log("📝 Loading configuration from database...");
  await loadConfigFromDB();
  console.log("✅ Configuration loaded\n");

  const engine = new ArbitrageEngine();

  // Event listeners for monitoring
  engine.on("opportunity", (opportunity) => {
    // Opportunity detected and logged by engine
  });

  engine.on("decision", (decision) => {
    // Decision logged by engine
  });

  engine.on("error", (error) => {
    console.error("❌ Engine Error:", error);
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n\n⚠️  Received SIGINT signal");
    if (engine.wsServer) {
      engine.wsServer.stop();
    }
    if (engine.apiServer) {
      await engine.apiServer.stop();
    }
    await engine.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\n\n⚠️  Received SIGTERM signal");
    if (engine.wsServer) {
      engine.wsServer.stop();
    }
    if (engine.apiServer) {
      await engine.apiServer.stop();
    }
    await engine.stop();
    process.exit(0);
  });

  // Handle uncaught errors
  process.on("uncaughtException", async (error) => {
    console.error("💥 Uncaught Exception:", error);
    await engine.stop();
    process.exit(1);
  });

  process.on("unhandledRejection", async (reason, promise) => {
    console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
    await engine.stop();
    process.exit(1);
  });

  // Start the engine
  try {
    await engine.start();

    // ========================================
    // START WEBSOCKET SERVER FOR DASHBOARD
    // ========================================
    console.log("\n🚀 Starting WebSocket server for frontend dashboard...");
    const wsServer = new WebSocketServer(engine);
    wsServer.start(5003);
    console.log("✅ Dashboard available at http://localhost:3000\n");

    // Store wsServer for cleanup
    engine.wsServer = wsServer;

    // ========================================
    // START REST API SERVER FOR CONFIG MANAGEMENT
    // ========================================
    console.log("🚀 Starting REST API server for configuration...");
    const apiServer = new APIServer(5004);
    await apiServer.start();
    console.log("✅ REST API available at http://localhost:5004\n");

    // Store apiServer for cleanup
    engine.apiServer = apiServer;

    // Display status every 30 seconds
    setInterval(() => {
      const opportunities = engine.getCurrentOpportunities();
      const lastDecision = engine.getLastDecision();

      console.log("\n" + "─".repeat(60));
      console.log("📊 STATUS UPDATE");
      console.log("─".repeat(60));
      console.log(`Opportunities Found: ${opportunities.length}`);
      console.log(
        `Last Decision: ${lastDecision ? lastDecision.decision : "None"}`
      );
      console.log(`Timestamp: ${new Date().toLocaleString()}`);
      console.log("─".repeat(60) + "\n");
    }, 30000);
  } catch (error) {
    console.error("❌ Fatal Error:", error);
    await engine.stop();
    process.exit(1);
  }
}

// Run the application
main().catch((error) => {
  console.error("💥 Fatal Error in main():", error);
  process.exit(1);
});
