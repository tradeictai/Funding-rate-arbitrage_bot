/**
 * ConfigSettings Model
 * Stores user-configurable trading parameters in MongoDB
 * Sensitive data (API keys) remain in .env file
 */

export const configSettingsSchema = {
  _id: "trading_config", // Single document pattern

  // Trading Parameters
  leverage: {
    type: Number,
    default: 10,
    min: 1,
    max: 125,
  },
  useFundPct: {
    type: Number,
    default: 0.15,
    min: 0.01,
    max: 1.0,
  },
  primaryThreshold: {
    type: Number,
    default: 0.1,
    min: 0.01,
    max: 10.0,
  },
  secondaryThreshold: {
    type: Number,
    default: 0.1,
    min: 0.01,
    max: 10.0,
  },

  // Time Windows
  preFundingWindowMinutes: {
    type: Number,
    default: 5,
    min: 1,
    max: 60,
  },

  // Position Sizing
  maxPositionSizeUSD: {
    type: Number,
    default: 1000,
    min: 1,
    max: 100000,
  },
  minPositionSizeUSD: {
    type: Number,
    default: 0.5,
    min: 0.1,
    max: 1000,
  },

  // Liquidity & Slippage
  minLiquidityMultiplier: {
    type: Number,
    default: 3.0,
    min: 1.0,
    max: 10.0,
  },
  maxSlippagePct: {
    type: Number,
    default: 0.1,
    min: 0.01,
    max: 5.0,
  },
  orderbookDepth: {
    type: Number,
    default: 20,
    min: 5,
    max: 100,
  },

  // Order Execution
  orderCooldownMinutes: {
    type: Number,
    default: 5,
    min: 0,
    max: 1440, // 24 hours
  },

  // Metadata
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  updatedBy: {
    type: String,
    default: "system",
  },
};

/**
 * Default config values (fallback if DB is empty)
 */
export const defaultConfigValues = {
  _id: "trading_config",
  leverage: 10,
  useFundPct: 0.70,
  primaryThreshold: 0.1,
  secondaryThreshold: 0.15,
  preFundingWindowMinutes: 5,
  maxPositionSizeUSD: 1000,
  minPositionSizeUSD: 0.5,
  minLiquidityMultiplier: 3.0,
  maxSlippagePct: 0.1,
  orderbookDepth: 20,
  orderCooldownMinutes: 5,
  updatedAt: new Date(),
  updatedBy: "system",
};

/**
 * Validation rules for config updates
 */
export const validateConfig = (config) => {
  const errors = [];

  // Leverage validation
  if (config.leverage !== undefined) {
    if (config.leverage < 1 || config.leverage > 125) {
      errors.push("leverage must be between 1 and 125");
    }
  }

  // Use Fund Percentage validation
  if (config.useFundPct !== undefined) {
    if (config.useFundPct < 0.01 || config.useFundPct > 1.0) {
      errors.push("useFundPct must be between 0.01 and 1.0");
    }
  }

  // Threshold validations
  if (config.primaryThreshold !== undefined) {
    if (config.primaryThreshold < 0.01 || config.primaryThreshold > 10.0) {
      errors.push("primaryThreshold must be between 0.01 and 10.0");
    }
  }

  if (config.secondaryThreshold !== undefined) {
    if (config.secondaryThreshold < 0.01 || config.secondaryThreshold > 10.0) {
      errors.push("secondaryThreshold must be between 0.01 and 10.0");
    }
  }

  // Position size validations
  if (config.maxPositionSizeUSD !== undefined) {
    if (config.maxPositionSizeUSD < 1 || config.maxPositionSizeUSD > 100000) {
      errors.push("maxPositionSizeUSD must be between 1 and 100000");
    }
  }

  if (config.minPositionSizeUSD !== undefined) {
    if (config.minPositionSizeUSD < 0.1 || config.minPositionSizeUSD > 1000) {
      errors.push("minPositionSizeUSD must be between 0.1 and 1000");
    }
  }

  // Ensure max > min for position sizes
  if (config.maxPositionSizeUSD && config.minPositionSizeUSD) {
    if (config.maxPositionSizeUSD <= config.minPositionSizeUSD) {
      errors.push("maxPositionSizeUSD must be greater than minPositionSizeUSD");
    }
  }

  // Liquidity validation
  if (config.minLiquidityMultiplier !== undefined) {
    if (config.minLiquidityMultiplier < 1.0 || config.minLiquidityMultiplier > 10.0) {
      errors.push("minLiquidityMultiplier must be between 1.0 and 10.0");
    }
  }

  // Slippage validation
  if (config.maxSlippagePct !== undefined) {
    if (config.maxSlippagePct < 0.01 || config.maxSlippagePct > 5.0) {
      errors.push("maxSlippagePct must be between 0.01 and 5.0");
    }
  }

  // Orderbook depth validation
  if (config.orderbookDepth !== undefined) {
    if (config.orderbookDepth < 5 || config.orderbookDepth > 100) {
      errors.push("orderbookDepth must be between 5 and 100");
    }
  }

  // Cooldown validation
  if (config.orderCooldownMinutes !== undefined) {
    if (config.orderCooldownMinutes < 0 || config.orderCooldownMinutes > 1440) {
      errors.push("orderCooldownMinutes must be between 0 and 1440");
    }
  }

  // Pre-funding window validation
  if (config.preFundingWindowMinutes !== undefined) {
    if (config.preFundingWindowMinutes < 1 || config.preFundingWindowMinutes > 60) {
      errors.push("preFundingWindowMinutes must be between 1 and 60");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};
