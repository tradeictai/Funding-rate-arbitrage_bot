/**
 * Dynamic Config Loader - DEBUG VERSION
 * This version includes extensive logging to identify the issue
 */

import dotenv from "dotenv";
import configService from "../services/configService.js";

dotenv.config();

/**
 * Static config (always loaded from .env - for sensitive data)
 */
const staticConfig = {
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
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },
  mongodb: {
    uri:
      process.env.MONGODB_URI || "mongodb://localhost:27017/funding-arbitrage",
    dbName: process.env.MONGODB_DB_NAME || "funding-arbitrage",
  },
  env: process.env.NODE_ENV || "development",
};

/**
 * Get default trading config from .env
 */
function getDefaultTradingConfig() {
  return {
    leverage: parseInt(process.env.LEVERAGE) || 10,
    useFundPct: parseFloat(process.env.USE_FUND_PCT) || 0.15,
    primaryThreshold: parseFloat(process.env.PRIMARY_THRESHOLD) || 0.1,
    secondaryThreshold: parseFloat(process.env.SECONDARY_THRESHOLD) || 0.1,
    fundingTimeWindowSeconds:
      parseInt(process.env.FUNDING_TIME_WINDOW_SECONDS) || 60,
    bufferPercentForLiquidationProtection:
      parseFloat(process.env.BUFFER_PERCENT_FOR_LIQUIDATION_PROTECTION) || 30,
    minFillPct: parseFloat(process.env.MIN_FILL_PCT) || 0.95,
    entryTimeoutSeconds: parseInt(process.env.ENTRY_TIMEOUT_SECONDS) || 30,
    pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS) || 5,
    maxWaitForFundingSeconds:
      parseInt(process.env.MAX_WAIT_FOR_FUNDING_SECONDS) || 300,
    preFundingWindowMinutes:
      parseInt(process.env.PRE_FUNDING_WINDOW_MINUTES) || 5,
    maxQueuedOpps: parseInt(process.env.MAX_QUEUED_OPPS) || 15,
    maxPositionSizeUSD: parseFloat(process.env.MAX_POSITION_SIZE_USD) || 1000,
    minPositionSizeUSD: parseFloat(process.env.MIN_POSITION_SIZE_USD) || 0.5,
    minLiquidityMultiplier:
      parseFloat(process.env.MIN_LIQUIDITY_MULTIPLIER) || 3.0,
    maxSlippagePct: parseFloat(process.env.MAX_SLIPPAGE_PCT) || 0.1,
    orderbookDepth: parseInt(process.env.ORDERBOOK_DEPTH) || 20,
    minNetProfitPct: parseFloat(process.env.MIN_NET_PROFIT_PCT) || 0.05,
    paperTradingMode: process.env.PAPER_TRADING_MODE === "true" || false,
    orderCooldownMinutes: parseInt(process.env.ORDER_COOLDOWN_MINUTES) || 5,
    quantityTolerance: parseFloat(process.env.QUANTITY_TOLERANCE) || 0,
  };
}

/**
 * Runtime config
 */
let runtimeConfig = {
  ...staticConfig,
  trading: getDefaultTradingConfig(),
};

/**
 * Load configuration from MongoDB and merge with static config
 */
export async function loadConfigFromDB() {
  try {
    console.log("\n" + "=".repeat(70));
    console.log("🔍 LOADING CONFIGURATION FROM DATABASE");
    console.log("=".repeat(70));

    // Initialize config service if not already connected
    if (!configService.isConnected) {
      await configService.initialize(
        staticConfig.mongodb.uri,
        staticConfig.mongodb.dbName,
      );
    }

    // Get config from database
    const dbConfig = await configService.getConfig();

    console.log("\n📊 DATABASE CONFIG RECEIVED:");
    console.log("   Raw dbConfig object:", JSON.stringify(dbConfig, null, 2));

    // Check each field individually
    console.log("\n🔍 FIELD-BY-FIELD ANALYSIS:");

    const fields = [
      "leverage",
      "useFundPct",
      "primaryThreshold",
      "secondaryThreshold",
      "preFundingWindowMinutes",
      "maxPositionSizeUSD",
      "minPositionSizeUSD",
      "minLiquidityMultiplier",
      "maxSlippagePct",
      "orderbookDepth",
      "orderCooldownMinutes",
      "bufferPercentForLiquidationProtection",
    ];

    fields.forEach((field) => {
      const dbValue = dbConfig[field];
      const envKey = field.replace(/([A-Z])/g, "_$1").toUpperCase();
      const envValue = process.env[envKey];

      console.log(`\n   ${field}:`);
      console.log(`      DB Value: ${dbValue} (type: ${typeof dbValue})`);
      console.log(
        `      .env Value: ${envValue} (parsed: ${parseFloat(envValue) || parseInt(envValue)})`,
      );
      console.log(
        `      Will use: ${dbValue ?? (parseFloat(envValue) || parseInt(envValue))}`,
      );
    });

    // Merge DB config into runtime config with explicit priority
    console.log("\n🔄 MERGING CONFIGURATION...");

    const newTradingConfig = {
      // DB values with .env fallback
      leverage: dbConfig.leverage ?? parseInt(process.env.LEVERAGE) ?? 10,
      useFundPct:
        dbConfig.useFundPct ?? parseFloat(process.env.USE_FUND_PCT) ?? 0.15,
      primaryThreshold:
        dbConfig.primaryThreshold ??
        parseFloat(process.env.PRIMARY_THRESHOLD) ??
        0.1,
      secondaryThreshold:
        dbConfig.secondaryThreshold ??
        parseFloat(process.env.SECONDARY_THRESHOLD) ??
        0.1,
      preFundingWindowMinutes:
        dbConfig.preFundingWindowMinutes ??
        parseInt(process.env.PRE_FUNDING_WINDOW_MINUTES) ??
        5,
      maxPositionSizeUSD:
        dbConfig.maxPositionSizeUSD ??
        parseFloat(process.env.MAX_POSITION_SIZE_USD) ??
        1000,
      minPositionSizeUSD:
        dbConfig.minPositionSizeUSD ??
        parseFloat(process.env.MIN_POSITION_SIZE_USD) ??
        0.5,
      minLiquidityMultiplier:
        dbConfig.minLiquidityMultiplier ??
        parseFloat(process.env.MIN_LIQUIDITY_MULTIPLIER) ??
        3.0,
      maxSlippagePct:
        dbConfig.maxSlippagePct ??
        parseFloat(process.env.MAX_SLIPPAGE_PCT) ??
        0.1,
      orderbookDepth:
        dbConfig.orderbookDepth ?? parseInt(process.env.ORDERBOOK_DEPTH) ?? 20,
      orderCooldownMinutes:
        dbConfig.orderCooldownMinutes ??
        parseInt(process.env.ORDER_COOLDOWN_MINUTES) ??
        5,
      bufferPercentForLiquidationProtection:
        dbConfig.bufferPercentForLiquidationProtection ??
        parseFloat(process.env.BUFFER_PERCENT_FOR_LIQUIDATION_PROTECTION) ??
        30,

      // .env only fields
      fundingTimeWindowSeconds:
        parseInt(process.env.FUNDING_TIME_WINDOW_SECONDS) || 60,
      minFillPct: parseFloat(process.env.MIN_FILL_PCT) || 0.95,
      entryTimeoutSeconds: parseInt(process.env.ENTRY_TIMEOUT_SECONDS) || 30,
      pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS) || 5,
      maxWaitForFundingSeconds:
        parseInt(process.env.MAX_WAIT_FOR_FUNDING_SECONDS) || 300,
      maxQueuedOpps: parseInt(process.env.MAX_QUEUED_OPPS) || 15,
      minNetProfitPct: parseFloat(process.env.MIN_NET_PROFIT_PCT) || 0.05,
      paperTradingMode: process.env.PAPER_TRADING_MODE === "true" || false,
      quantityTolerance: parseFloat(process.env.QUANTITY_TOLERANCE) || 0,
    };

    runtimeConfig.trading = newTradingConfig;

    console.log("\n✅ FINAL TRADING CONFIG:");
    console.log(JSON.stringify(newTradingConfig, null, 2));

    // Merge API credentials
    runtimeConfig.orderPlace = {
      delta: {
        apiKey: dbConfig.deltaApiKey || process.env.DELTA_API_KEY_trade || "",
        apiSecret:
          dbConfig.deltaApiSecret || process.env.DELTA_API_SECRET_trade || "",
      },
      pi42: {
        apiKey: process.env.PI42_API_KEY_trade || "",
        apiSecret: process.env.PI42_API_SECRET_trade || "",
      },
      coindcx: {
        apiKey: dbConfig.coindcxApiKey || process.env.COINDCX_API_KEY || "",
        apiSecret:
          dbConfig.coindcxApiSecret || process.env.COINDCX_API_SECRET || "",
      },
    };

    console.log("\n" + "=".repeat(70));
    console.log("✅ CONFIGURATION LOAD COMPLETE");
    console.log("=".repeat(70));
    console.log(
      `   Leverage: ${runtimeConfig.trading.leverage} (from ${dbConfig.leverage !== undefined ? "DB" : ".env"})`,
    );
    console.log(
      `   Use Fund %: ${runtimeConfig.trading.useFundPct} (from ${dbConfig.useFundPct !== undefined ? "DB" : ".env"})`,
    );
    console.log(
      `   Primary Threshold: ${runtimeConfig.trading.primaryThreshold}% (from ${dbConfig.primaryThreshold !== undefined ? "DB" : ".env"})`,
    );
    console.log(
      `   Max Position Size: $${runtimeConfig.trading.maxPositionSizeUSD} (from ${dbConfig.maxPositionSizeUSD !== undefined ? "DB" : ".env"})`,
    );
    console.log("=".repeat(70) + "\n");

    return runtimeConfig;
  } catch (error) {
    console.error("\n❌ [ConfigLoader] Failed to load from DB:", error.message);
    console.error("   Stack:", error.stack);
    console.error("   Using defaults from .env\n");
    return runtimeConfig;
  }
}

/**
 * Get current runtime configuration
 */
export function getConfig() {
  return runtimeConfig;
}

/**
 * Reload configuration from database
 */
export async function reloadConfig() {
  console.log("\n🔄 [ConfigLoader] RELOADING CONFIGURATION...");
  const result = await loadConfigFromDB();
  console.log("✅ [ConfigLoader] Configuration reload complete\n");
  return result;
}

export default runtimeConfig;
