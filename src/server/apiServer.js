/**
 * Express REST API Server
 * Provides HTTP endpoints for frontend communication
 * Separate from Socket.IO WebSocket server
 */

import express from "express";
import cors from "cors";
import settingsRoutes from "../routes/settingsRoutes.js";

class APIServer {
  constructor(port = 5004) {
    this.port = port;
    this.app = express();
    this.server = null;
  }

  /**
   * Initialize Express app with middleware
   */
  initializeMiddleware() {
    // CORS configuration
    this.app.use(
      cors({
        origin: ["http://localhost:3000", "http://localhost:3001"], // Add your frontend URLs
        credentials: true,
      })
    );

    // JSON body parser
    this.app.use(express.json());

    // Request logging middleware
    this.app.use((req, res, next) => {
      console.log(`[API] ${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * Setup API routes
   */
  initializeRoutes() {
    // Health check
    this.app.get("/health", (req, res) => {
      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        service: "Funding Rate Arbitrage Bot API",
      });
    });

    // Settings routes
    this.app.use("/api/settings", settingsRoutes);

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: "Endpoint not found",
        path: req.path,
      });
    });

    // Error handler
    this.app.use((err, req, res, next) => {
      console.error("[API] Error:", err);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: err.message,
      });
    });
  }

  /**
   * Start the API server
   */
  async start() {
    try {
      this.initializeMiddleware();
      this.initializeRoutes();

      this.server = this.app.listen(this.port, () => {
        console.log(`[API Server] REST API running on port ${this.port}`);
        console.log(`[API Server] Available endpoints:`);
        console.log(`  - GET  http://localhost:${this.port}/health`);
        console.log(`  - GET  http://localhost:${this.port}/api/settings`);
        console.log(`  - PUT  http://localhost:${this.port}/api/settings`);
        console.log(`  - POST http://localhost:${this.port}/api/settings/reset`);
        console.log(`  - GET  http://localhost:${this.port}/api/settings/fields`);
      });

      return this.server;
    } catch (error) {
      console.error("[API Server] Failed to start:", error);
      throw error;
    }
  }

  /**
   * Stop the API server
   */
  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log("[API Server] Stopped");
          resolve();
        });
      });
    }
  }
}

export default APIServer;
