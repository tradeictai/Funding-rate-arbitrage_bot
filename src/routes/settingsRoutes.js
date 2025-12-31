/**
 * Settings API Routes
 * REST endpoints for managing trading configuration
 */

import express from "express";
import configService from "../services/configService.js";

const router = express.Router();

/**
 * GET /api/settings
 * Get current configuration settings
 */
router.get("/", async (req, res) => {
  try {
    const config = await configService.getConfig();

    res.json({
      success: true,
      data: config,
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

    // Update config
    const result = await configService.updateConfig(updates, "frontend");

    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.errors,
      });
    }

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
  };

  res.json({
    success: true,
    data: fields,
  });
});

export default router;
