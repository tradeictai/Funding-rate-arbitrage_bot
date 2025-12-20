import dotenv from 'dotenv';
dotenv.config();

const config = {
  // Exchange WebSocket URLs
  exchanges: {
    delta: {
      wsUrl: 'wss://socket.india.delta.exchange',
      apiKey: process.env.DELTA_API_KEY || '',
      apiSecret: process.env.DELTA_API_SECRET || ''
    },
    pi42: {
      wsUrl: 'https://fawss.pi42.com/',
      apiKey: process.env.PI42_API_KEY || '',
      apiSecret: process.env.PI42_API_SECRET || ''
    }

  },


  orderPlace: {
    delta: {
      apiKey: process.env.DELTA_API_KEY_trade || '',
      apiSecret: process.env.DELTA_API_SECRET_trade || ''
    },
    pi42: {
      apiKey: process.env.PI42_API_KEY_trade || '',
      apiSecret: process.env.PI42_API_SECRET_trade || ''
    },
    coindcx: {
     apiKey: process.env.COINDCX_API_KEY || '',
      apiSecret: process.env.COINDCX_API_SECRET || ''
    }
  },

  // Redis Configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined
  },

  // MongoDB Configuration
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/funding-arbitrage',
    dbName: process.env.MONGODB_DB_NAME || 'funding-arbitrage'
  },

  // Trading Parameters
  trading: {
    leverage: parseInt(process.env.LEVERAGE) || 10,
    useFundPct: parseFloat(process.env.USE_FUND_PCT) || 0.70,
    primaryThreshold: parseFloat(process.env.PRIMARY_THRESHOLD) || 0.01,  // 0.1%
    secondaryThreshold: parseFloat(process.env.SECONDARY_THRESHOLD) || 0.01,  // 0.1%
    fundingTimeWindowSeconds: parseInt(process.env.FUNDING_TIME_WINDOW_SECONDS) || 60,
    minFillPct: parseFloat(process.env.MIN_FILL_PCT) || 0.95,
    entryTimeoutSeconds: parseInt(process.env.ENTRY_TIMEOUT_SECONDS) || 30,
    pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS) || 5,
    maxWaitForFundingSeconds: parseInt(process.env.MAX_WAIT_FOR_FUNDING_SECONDS) || 300,

    // Phase 2: Position Sizing
    maxPositionSizeUSD: parseFloat(process.env.MAX_POSITION_SIZE_USD) || 1000,
    minPositionSizeUSD: parseFloat(process.env.MIN_POSITION_SIZE_USD) || 0.5,

    // Phase 2: Liquidity & Slippage
    minLiquidityMultiplier: parseFloat(process.env.MIN_LIQUIDITY_MULTIPLIER) || 3.0,
    maxSlippagePct: parseFloat(process.env.MAX_SLIPPAGE_PCT) || 0.1, // 0.1% max slippage
    orderbookDepth: parseInt(process.env.ORDERBOOK_DEPTH) || 20,

    // Phase 2: Profit Requirements
    minNetProfitPct: parseFloat(process.env.MIN_NET_PROFIT_PCT) || 0.05, // 0.05% minimum net profit

    // Phase 2: Testing
    paperTradingMode: process.env.PAPER_TRADING_MODE === 'true' || false, // Real trading mode enabled

    // Phase 3: Order Execution Cooldown
    orderCooldownMinutes: parseInt(process.env.ORDER_COOLDOWN_MINUTES) || 120, // 15 minutes cooldown between orders

    // Phase 4: Trade Monitoring
    quantityTolerance: parseFloat(process.env.QUANTITY_TOLERANCE) || 0, // 5% tolerance for quantity mismatch

    // Phase 5: Exit Logic
    maxWaitForFundingSeconds: parseInt(process.env.MAX_WAIT_FOR_FUNDING_SECONDS) || 300 // 5 minutes wait for funding
  },

  // Environment
  env: process.env.NODE_ENV || 'development'
};

export default config;
