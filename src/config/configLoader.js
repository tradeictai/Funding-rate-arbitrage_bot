/**
 * Dynamic Config Loader
 * Loads configuration from MongoDB and merges with environment variables
 * This module provides runtime config updates from database
 */

import dotenv from "dotenv";
import configService from "../services/configService.js";

dotenv.config();

/**
 * Static config (always loaded from .env - for sensitive data)
 */
const staticConfig = {
  // Exchange WebSocket URLs and credentials (NEVER stored in DB)
  exchanges: {
    delta: {
      wsUrl: "wss://socket.india.delta.exchange",
      apiKey: process.env.DELTA_API_KEY || "",
      apiSecret: process.env.DELTA_API_SECRET || "",
    },
    pi42: {
      wsUrl: "https://fawss.pi42.com/",
      apiKey: process.env.PI42_API_KEY || "",
      apiSecret: process.env.PI42_API_SECRET || "",
    },
  },

  orderPlace: {
    delta: {
      apiKey: process.env.DELTA_API_KEY_trade || "",
      apiSecret: process.env.DELTA_API_SECRET_trade || "",
    },
    pi42: {
      apiKey: process.env.PI42_API_KEY_trade || "",
      apiSecret: process.env.PI42_API_SECRET_trade || "",
    },
    coindcx: {
      apiKey: process.env.COINDCX_API_KEY || "",
      apiSecret: process.env.COINDCX_API_SECRET || "",
    },
  },

  // Redis Configuration (NEVER stored in DB)
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  // MongoDB Configuration (NEVER stored in DB)
  mongodb: {
    uri: process.env.MONGODB_URI || "mongodb://localhost:27017/funding-arbitrage",
    dbName: process.env.MONGODB_DB_NAME || "funding-arbitrage",
  },

  // Environment
  env: process.env.NODE_ENV || "development",
};

/**
 * Runtime config (merged from DB + static)
 * This object is updated when config changes
 */
let runtimeConfig = {
  ...staticConfig,
  trading: {
    // Default values (will be overwritten by DB)
    leverage: parseInt(process.env.LEVERAGE) || 10,
    useFundPct: parseFloat(process.env.USE_FUND_PCT) || 0.15,
    primaryThreshold: parseFloat(process.env.PRIMARY_THRESHOLD) || 0.1,
    secondaryThreshold: parseFloat(process.env.SECONDARY_THRESHOLD) || 0.1,
    fundingTimeWindowSeconds: parseInt(process.env.FUNDING_TIME_WINDOW_SECONDS) || 60,
    minFillPct: parseFloat(process.env.MIN_FILL_PCT) || 0.95,
    entryTimeoutSeconds: parseInt(process.env.ENTRY_TIMEOUT_SECONDS) || 30,
    pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS) || 5,
    maxWaitForFundingSeconds: parseInt(process.env.MAX_WAIT_FOR_FUNDING_SECONDS) || 300,
    preFundingWindowMinutes: parseInt(process.env.PRE_FUNDING_WINDOW_MINUTES) || 5,
    maxQueuedOpps: parseInt(process.env.MAX_QUEUED_OPPS) || 15,
    maxPositionSizeUSD: parseFloat(process.env.MAX_POSITION_SIZE_USD) || 1000,
    minPositionSizeUSD: parseFloat(process.env.MIN_POSITION_SIZE_USD) || 0.5,
    minLiquidityMultiplier: parseFloat(process.env.MIN_LIQUIDITY_MULTIPLIER) || 3.0,
    maxSlippagePct: parseFloat(process.env.MAX_SLIPPAGE_PCT) || 0.1,
    orderbookDepth: parseInt(process.env.ORDERBOOK_DEPTH) || 20,
    minNetProfitPct: parseFloat(process.env.MIN_NET_PROFIT_PCT) || 0.05,
    paperTradingMode: process.env.PAPER_TRADING_MODE === "true" || false,
    orderCooldownMinutes: parseInt(process.env.ORDER_COOLDOWN_MINUTES) || 5,
    quantityTolerance: parseFloat(process.env.QUANTITY_TOLERANCE) || 0,
  },
};

/**
 * Load configuration from MongoDB and merge with static config
 */
export async function loadConfigFromDB() {
  try {
    // Initialize config service if not already connected
    if (!configService.isConnected) {
      await configService.initialize(
        staticConfig.mongodb.uri,
        staticConfig.mongodb.dbName
      );
    }

    // Get config from database
    const dbConfig = await configService.getConfig();

    // Merge DB config into runtime config
    runtimeConfig.trading = {
      ...runtimeConfig.trading,
      // Override with DB values
      leverage: dbConfig.leverage,
      useFundPct: dbConfig.useFundPct,
      primaryThreshold: dbConfig.primaryThreshold,
      secondaryThreshold: dbConfig.secondaryThreshold,
      preFundingWindowMinutes: dbConfig.preFundingWindowMinutes,
      maxPositionSizeUSD: dbConfig.maxPositionSizeUSD,
      minPositionSizeUSD: dbConfig.minPositionSizeUSD,
      minLiquidityMultiplier: dbConfig.minLiquidityMultiplier,
      maxSlippagePct: dbConfig.maxSlippagePct,
      orderbookDepth: dbConfig.orderbookDepth,
      orderCooldownMinutes: dbConfig.orderCooldownMinutes,
    };

    console.log("[ConfigLoader] Configuration loaded from database");
    return runtimeConfig;
  } catch (error) {
    console.error("[ConfigLoader] Failed to load from DB, using defaults:", error.message);
    return runtimeConfig; // Return defaults if DB fails
  }
}

/**
 * Get current runtime configuration
 */
export function getConfig() {
  return runtimeConfig;
}

/**
 * Reload configuration from database (call this after updates)
 */
export async function reloadConfig() {
  console.log("[ConfigLoader] Reloading configuration...");
  return await loadConfigFromDB();
}

// Export default config (for backward compatibility)
export default runtimeConfig;
