/**
 * Settings API Routes
 * REST endpoints for managing trading configuration
 */

import express from "express";
import https from "https";
import http from "http";
import os from "os";
import configService from "../services/configService.js";
import { reloadConfig } from "../config/configLoader.js";

const router = express.Router();

/**
 * Utility function to get public IP address
 * Tries multiple services for reliability
 */
async function getPublicIP() {
  const services = [
    { url: "https://api.ipify.org?format=json", parser: (data) => JSON.parse(data).ip },
    { url: "https://ipinfo.io/json", parser: (data) => JSON.parse(data).ip },
    { url: "https://api.my-ip.io/ip.json", parser: (data) => JSON.parse(data).ip },
    { url: "http://ip-api.com/json", parser: (data) => JSON.parse(data).query, protocol: http },
  ];

  for (const service of services) {
    try {
      const ip = await new Promise((resolve, reject) => {
        const protocol = service.protocol || https;
        const req = protocol.get(service.url, { timeout: 5000 }, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(service.parser(data));
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Timeout"));
        });
      });
      if (ip) return ip;
    } catch (e) {
      // Try next service
      continue;
    }
  }
  return null;
}

/**
 * Get local network IPs
 */
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === "IPv4" && !iface.internal) {
        ips.push({
          interface: name,
          address: iface.address,
        });
      }
    }
  }
  return ips;
}

/**
 * Helper function to mask sensitive data (defined early for use in routes)
 */
function maskSecretEarly(secret) {
  if (!secret || secret.length === 0) return "";
  if (secret.length <= 8) return "****";
  return secret.substring(0, 4) + "****" + secret.substring(secret.length - 4);
}

/**
 * GET /api/settings
 * Get current configuration settings
 * Note: API credentials are masked for security
 */
router.get("/", async (req, res) => {
  try {
    const config = await configService.getConfig();

    // Create a safe copy with masked credentials
    const safeConfig = {
      ...config,
      deltaApiKey: maskSecretEarly(config.deltaApiKey),
      deltaApiSecret: maskSecretEarly(config.deltaApiSecret),
      coindcxApiKey: maskSecretEarly(config.coindcxApiKey),
      coindcxApiSecret: maskSecretEarly(config.coindcxApiSecret),
    };

    res.json({
      success: true,
      data: safeConfig,
    });
  } catch (error) {
    console.error("[API] Error getting settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get settings",
      message: error.message,
    });
  }
});

/**
 * PUT /api/settings
 * Update configuration settings
 *
 * Body example:
 * {
 *   "leverage": 15,
 *   "primaryThreshold": 0.15,
 *   "maxPositionSizeUSD": 2000
 * }
 */
router.put("/", async (req, res) => {
  try {
    const updates = req.body;

    // Update config in database
    const result = await configService.updateConfig(updates, "frontend");

    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.errors,
      });
    }

    // IMPORTANT: Reload the runtime config so the bot uses updated values
    await reloadConfig();
    console.log("[API] Runtime config reloaded after settings update");

    res.json({
      success: true,
      message: "Settings updated successfully",
      data: result.config,
      modified: result.modified,
    });
  } catch (error) {
    console.error("[API] Error updating settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update settings",
      message: error.message,
    });
  }
});

/**
 * POST /api/settings/reset
 * Reset configuration to defaults
 */
router.post("/reset", async (req, res) => {
  try {
    const result = await configService.resetConfig();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        errors: result.errors,
      });
    }

    // IMPORTANT: Reload the runtime config so the bot uses updated values
    await reloadConfig();
    console.log("[API] Runtime config reloaded after settings reset");

    res.json({
      success: true,
      message: "Settings reset to defaults",
      data: result.config,
    });
  } catch (error) {
    console.error("[API] Error resetting settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to reset settings",
      message: error.message,
    });
  }
});

/**
 * GET /api/settings/credentials
 * Get API credentials status (masked for security)
 */
router.get("/credentials", async (req, res) => {
  try {
    const config = await configService.getConfig();

    res.json({
      success: true,
      data: {
        delta: {
          apiKey: maskSecretEarly(config.deltaApiKey),
          apiSecret: maskSecretEarly(config.deltaApiSecret),
          isSet: !!(config.deltaApiKey && config.deltaApiSecret),
        },
        coindcx: {
          apiKey: maskSecretEarly(config.coindcxApiKey),
          apiSecret: maskSecretEarly(config.coindcxApiSecret),
          isSet: !!(config.coindcxApiKey && config.coindcxApiSecret),
        },
      },
    });
  } catch (error) {
    console.error("[API] Error getting credentials:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get credentials",
      message: error.message,
    });
  }
});

/**
 * PUT /api/settings/credentials
 * Update API credentials for exchanges
 *
 * Body example:
 * {
 *   "deltaApiKey": "your-delta-api-key",
 *   "deltaApiSecret": "your-delta-api-secret",
 *   "coindcxApiKey": "your-coindcx-api-key",
 *   "coindcxApiSecret": "your-coindcx-api-secret"
 * }
 */
router.put("/credentials", async (req, res) => {
  try {
    const { deltaApiKey, deltaApiSecret, coindcxApiKey, coindcxApiSecret } = req.body;

    // Build update object with only provided fields
    const updates = {};
    if (deltaApiKey !== undefined) updates.deltaApiKey = deltaApiKey;
    if (deltaApiSecret !== undefined) updates.deltaApiSecret = deltaApiSecret;
    if (coindcxApiKey !== undefined) updates.coindcxApiKey = coindcxApiKey;
    if (coindcxApiSecret !== undefined) updates.coindcxApiSecret = coindcxApiSecret;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No credentials provided to update",
      });
    }

    // Update config
    const result = await configService.updateConfig(updates, "frontend");

    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.errors,
      });
    }

    // Reload runtime config so bot uses new credentials
    await reloadConfig();
    console.log("[API] API credentials updated and config reloaded");

    // Return masked credentials for confirmation
    res.json({
      success: true,
      message: "API credentials updated successfully",
      data: {
        delta: {
          apiKey: maskSecretEarly(result.config.deltaApiKey),
          apiSecret: maskSecretEarly(result.config.deltaApiSecret),
          isSet: !!(result.config.deltaApiKey && result.config.deltaApiSecret),
        },
        coindcx: {
          apiKey: maskSecretEarly(result.config.coindcxApiKey),
          apiSecret: maskSecretEarly(result.config.coindcxApiSecret),
          isSet: !!(result.config.coindcxApiKey && result.config.coindcxApiSecret),
        },
      },
    });
  } catch (error) {
    console.error("[API] Error updating credentials:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update credentials",
      message: error.message,
    });
  }
});

/**
 * DELETE /api/settings/credentials/:exchange
 * Clear API credentials for a specific exchange
 * :exchange can be 'delta' or 'coindcx'
 */
router.delete("/credentials/:exchange", async (req, res) => {
  try {
    const { exchange } = req.params;

    if (!["delta", "coindcx"].includes(exchange)) {
      return res.status(400).json({
        success: false,
        error: "Invalid exchange. Must be 'delta' or 'coindcx'",
      });
    }

    // Clear credentials for the specified exchange
    const updates = {};
    if (exchange === "delta") {
      updates.deltaApiKey = "";
      updates.deltaApiSecret = "";
    } else {
      updates.coindcxApiKey = "";
      updates.coindcxApiSecret = "";
    }

    const result = await configService.updateConfig(updates, "frontend");

    if (!result.success) {
      return res.status(500).json({
        success: false,
        errors: result.errors,
      });
    }

    // Reload runtime config
    await reloadConfig();
    console.log(`[API] ${exchange} credentials cleared and config reloaded`);

    res.json({
      success: true,
      message: `${exchange} credentials cleared successfully`,
    });
  } catch (error) {
    console.error("[API] Error clearing credentials:", error);
    res.status(500).json({
      success: false,
      error: "Failed to clear credentials",
      message: error.message,
    });
  }
});

/**
 * GET /api/settings/server-ip
 * Get bot server IP information for exchange whitelisting
 */
router.get("/server-ip", async (req, res) => {
  try {
    const config = await configService.getConfig();

    // Get current public IP
    const publicIP = await getPublicIP();

    // Get local network IPs
    const localIPs = getLocalIPs();

    // Update stored IP if changed
    if (publicIP && publicIP !== config.botServerIp) {
      await configService.updateConfig(
        {
          botServerIp: publicIP,
          botServerLastSeen: new Date(),
        },
        "system"
      );
      console.log(`[API] Bot server IP updated: ${publicIP}`);
    } else if (publicIP) {
      // Just update last seen time
      await configService.updateConfig(
        { botServerLastSeen: new Date() },
        "system"
      );
    }

    res.json({
      success: true,
      data: {
        publicIP: publicIP || config.botServerIp || "Unable to detect",
        storedIP: config.botServerIp || "Not stored yet",
        lastSeen: config.botServerLastSeen,
        localIPs: localIPs,
        hostname: os.hostname(),
        platform: os.platform(),
        message: publicIP
          ? "Whitelist this IP on your exchange accounts"
          : "Could not detect public IP. Using stored IP if available.",
      },
    });
  } catch (error) {
    console.error("[API] Error getting server IP:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get server IP",
      message: error.message,
    });
  }
});

/**
 * POST /api/settings/server-ip/refresh
 * Force refresh the server IP detection
 */
router.post("/server-ip/refresh", async (req, res) => {
  try {
    console.log("[API] Force refreshing server IP...");

    const publicIP = await getPublicIP();
    const localIPs = getLocalIPs();

    if (!publicIP) {
      return res.status(500).json({
        success: false,
        error: "Could not detect public IP",
        localIPs: localIPs,
      });
    }

    // Update in database
    const result = await configService.updateConfig(
      {
        botServerIp: publicIP,
        botServerLastSeen: new Date(),
      },
      "frontend"
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        errors: result.errors,
      });
    }

    res.json({
      success: true,
      message: "Server IP refreshed successfully",
      data: {
        publicIP: publicIP,
        localIPs: localIPs,
        lastSeen: new Date(),
        hostname: os.hostname(),
      },
    });
  } catch (error) {
    console.error("[API] Error refreshing server IP:", error);
    res.status(500).json({
      success: false,
      error: "Failed to refresh server IP",
      message: error.message,
    });
  }
});

/**
 * GET /api/settings/fields
 * Get list of configurable fields with their constraints
 */
router.get("/fields", (req, res) => {
  const fields = {
    leverage: {
      type: "number",
      min: 1,
      max: 125,
      default: 10,
      description: "Trading leverage multiplier",
    },
    useFundPct: {
      type: "number",
      min: 0.01,
      max: 1.0,
      default: 0.15,
      description: "Percentage of available funds to use per trade",
    },
    primaryThreshold: {
      type: "number",
      min: 0.01,
      max: 10.0,
      default: 0.1,
      description: "Primary funding rate threshold (%)",
    },
    secondaryThreshold: {
      type: "number",
      min: 0.01,
      max: 10.0,
      default: 0.1,
      description: "Secondary funding rate threshold (%)",
    },
    preFundingWindowMinutes: {
      type: "number",
      min: 1,
      max: 60,
      default: 5,
      description: "Minutes before funding time to enter position",
    },
    maxPositionSizeUSD: {
      type: "number",
      min: 1,
      max: 100000,
      default: 1000,
      description: "Maximum position size in USD",
    },
    minPositionSizeUSD: {
      type: "number",
      min: 0.1,
      max: 1000,
      default: 0.5,
      description: "Minimum position size in USD",
    },
    minLiquidityMultiplier: {
      type: "number",
      min: 1.0,
      max: 10.0,
      default: 3.0,
      description: "Minimum liquidity multiplier for position sizing",
    },
    maxSlippagePct: {
      type: "number",
      min: 0.01,
      max: 5.0,
      default: 0.1,
      description: "Maximum acceptable slippage (%)",
    },
    orderbookDepth: {
      type: "number",
      min: 5,
      max: 100,
      default: 20,
      description: "Orderbook depth levels to analyze",
    },
    orderCooldownMinutes: {
      type: "number",
      min: 0,
      max: 1440,
      default: 5,
      description: "Cooldown period between trades (minutes)",
    },
    bufferPercentForLiquidationProtection: {
      type: "number",
      min: 5,
      max: 50,
      default: 30,
      description: "Buffer percentage before liquidation price to trigger exit (%)",
    },
  };

  res.json({
    success: true,
    data: fields,
  });
});

export default router;
