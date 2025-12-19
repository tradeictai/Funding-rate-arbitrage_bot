# CEX Funding Rate Arbitrage

A sophisticated, production-ready funding rate arbitrage system between Delta Exchange and Pi42, implemented in Node.js with real-time WebSocket connections.

## Overview

This system identifies, executes, and monitors arbitrage opportunities based on funding rate differentials between two cryptocurrency exchanges. The implementation is complete with all five phases:

- **Phase 1**: Token Selection & Timing (✅ Complete)
- **Phase 2**: Position Sizing & Profit Calculation (✅ Complete)
- **Phase 3**: Order Execution with Safety Checks (✅ Complete)
- **Phase 4**: Real-time Trade Monitoring (✅ Complete)
- **Phase 5**: Intelligent Exit Logic (✅ Complete)

## Complete Feature Set

### Phase 1: Token Selection & Timing
- ✅ Bidirectional search (top 15 tokens from each exchange)
- ✅ Real-time funding rate monitoring via WebSocket
- ✅ Automatic token pair matching between exchanges
- ✅ Funding time alignment verification (±60s window)
- ✅ Primary threshold check (0.1%)
- ✅ Secondary threshold check (0.1%)
- ✅ Intelligent funding rate differential calculation
- ✅ Redis caching for performance
- ✅ MongoDB persistence for historical analysis

### Phase 2: Position Sizing & Profitability
- ✅ Balance fetching from both exchanges
- ✅ Dynamic position sizing (50% of total balance)
- ✅ Leverage integration (10x)
- ✅ Liquidity analysis (3x multiplier)
- ✅ Slippage estimation
- ✅ Net profit calculation after all fees
- ✅ Minimum profit threshold enforcement (0.05%)

### Phase 3: Order Execution
- ✅ Pre-execution funding rate re-verification
- ✅ Common position mapping (SHORT/LONG determination)
- ✅ Separate trading API keys for security
- ✅ Leverage setting on both exchanges
- ✅ Simultaneous order placement
- ✅ Fill verification (95% minimum)
- ✅ 15-minute cooldown between trades
- ✅ Comprehensive error handling

### Phase 4: Real-time Trade Monitoring
- ✅ Private WebSocket position tracking (Delta & Pi42)
- ✅ Real-time quantity verification (5% tolerance)
- ✅ Continuous flip safety monitoring (every 5 seconds)
- ✅ Automatic emergency exit triggering
- ✅ Position mismatch detection
- ✅ Funding rate change detection

### Phase 5: Intelligent Exit Logic
- ✅ Normal exit with funding credit verification
- ✅ Limit order exits for better execution
- ✅ Emergency exit with market orders
- ✅ Configurable funding credit timeout (5 minutes)
- ✅ Fallback from normal to emergency exit
- ✅ Exit result persistence to MongoDB
- ✅ Reduce-only flag for safety

## Technology Stack

- **Runtime**: Node.js v20+
- **Language**: JavaScript (ES6 modules)
- **Cache**: Redis 7+
- **Database**: MongoDB 7+
- **Exchanges**: Delta Exchange, Pi42
- **WebSocket Libraries**: ws, socket.io-client

## Project Structure

```
CEX-Funding-Rate-Arbitrage/
├── src/
│   ├── config/
│   │   └── config.js                    # Configuration management
│   ├── core/
│   │   ├── arbitrageEngine.js           # Main arbitrage orchestrator (All phases)
│   │   ├── positionSizer.js             # Phase 2: Position sizing
│   │   ├── liquidityAnalyzer.js         # Phase 2: Liquidity analysis
│   │   ├── profitCalculator.js          # Phase 2: Profit calculation
│   │   ├── orderExecutor.js             # Phase 3: Order execution
│   │   └── exitManager.js               # Phase 5: Exit logic
│   ├── exchanges/
│   │   ├── deltaExchange.js             # Delta Exchange WebSocket handler
│   │   └── pi42Exchange.js              # Pi42 Exchange WebSocket handler
│   ├── monitors/
│   │   ├── tradeMonitor.js              # Phase 4: Trade coordinator
│   │   ├── deltaPositionMonitor.js      # Phase 4: Delta position tracking
│   │   └── pi42PositionMonitor.js       # Phase 4: Pi42 position tracking
│   ├── services/
│   │   ├── deltaAPI.js                  # Delta Exchange REST API
│   │   ├── pi42API.js                   # Pi42 Exchange REST API
│   │   ├── redisService.js              # Redis caching service
│   │   └── mongoService.js              # MongoDB persistence service
│   ├── utils/
│   │   └── symbolMapper.js              # Symbol mapping utility
│   ├── test/
│   │   └── phase1-test.js               # Phase 1 test suite
│   └── index.js                         # Main entry point
├── .env.example                         # Environment variables template
├── PHASE3_DOCUMENTATION.md              # Phase 3 detailed docs
├── PHASE4_5_DOCUMENTATION.md            # Phase 4 & 5 detailed docs
├── SYSTEM_OVERVIEW.md                   # Complete system overview
├── .gitignore
├── package.json
└── README.md
```

## Prerequisites

### Software Requirements
1. **Node.js v20+**
   ```bash
   node --version  # Should be >= 20.0.0
   ```

2. **Redis 7+**
   ```bash
   # Windows (using Memurai or WSL)
   # Download from: https://www.memurai.com/

   # Linux/Mac
   redis-server --version
   ```

3. **MongoDB 7+**
   ```bash
   # Download from: https://www.mongodb.com/try/download/community
   mongod --version
   ```

### Exchange Requirements
- Delta Exchange account with API access
- Pi42 account with API access
- **Two sets of API credentials per exchange**:
  - Read-only keys for market data and balances
  - Trading keys for order placement
- Sufficient balance on both exchanges (minimum $100 recommended for testing)

## Installation

### 1. Clone/Navigate to Project
```bash
cd C:\Users\My\Desktop\CEX-Funding-Rate-Arbitrage
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
```bash
# Copy the example environment file
copy .env.example .env

# Edit .env with your settings
notepad .env
```

### 4. Start Required Services

**Redis:**
```bash
# Windows (Memurai)
# Start Memurai service from Windows Services

# Linux/Mac
redis-server
```

**MongoDB:**
```bash
# Windows
# Start MongoDB service from Windows Services

# Linux/Mac
mongod --dbpath /path/to/data
```

## Configuration

Edit `.env` file:

```env
# Exchange API Keys (Read-only for data)
DELTA_API_KEY=your_delta_api_key
DELTA_API_SECRET=your_delta_api_secret
PI42_API_KEY=your_pi42_api_key
PI42_API_SECRET=your_pi42_api_secret

# Trading API Keys (For order placement)
DELTA_API_KEY_trade=your_delta_trading_key
DELTA_API_SECRET_trade=your_delta_trading_secret
PI42_API_KEY_trade=your_pi42_trading_key
PI42_API_SECRET_trade=your_pi42_trading_secret

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/funding-arbitrage
MONGODB_DB_NAME=funding-arbitrage

# Phase 1: Opportunity Detection
PRIMARY_THRESHOLD=0.1
SECONDARY_THRESHOLD=0.1
FUNDING_TIME_WINDOW_SECONDS=60

# Phase 2: Position Sizing
LEVERAGE=10
USE_FUND_PCT=0.50
MAX_POSITION_SIZE_USD=1000
MIN_POSITION_SIZE_USD=0.5
MIN_LIQUIDITY_MULTIPLIER=3.0
MAX_SLIPPAGE_PCT=0.1
MIN_NET_PROFIT_PCT=0.05

# Phase 3: Order Execution
ORDER_COOLDOWN_MINUTES=15
MIN_FILL_PCT=0.95

# Phase 4: Trade Monitoring
QUANTITY_TOLERANCE=0.05
POLL_INTERVAL_SECONDS=5

# Phase 5: Exit Logic
MAX_WAIT_FOR_FUNDING_SECONDS=300

# System Configuration
NODE_ENV=production
PAPER_TRADING_MODE=false
```

### Key Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `PRIMARY_THRESHOLD` | Minimum funding rate differential for trades | 0.1% |
| `SECONDARY_THRESHOLD` | Secondary threshold for validation | 0.1% |
| `FUNDING_TIME_WINDOW_SECONDS` | Maximum time difference between funding periods | 60s |
| `LEVERAGE` | Trading leverage | 10x |
| `USE_FUND_PCT` | Percentage of available funds to use per trade | 50% |
| `ORDER_COOLDOWN_MINUTES` | Cooldown period between trades | 15 min |
| `QUANTITY_TOLERANCE` | Maximum allowed quantity mismatch | 5% |
| `MAX_WAIT_FOR_FUNDING_SECONDS` | Timeout for funding credit verification | 300s |
| `PAPER_TRADING_MODE` | Enable paper trading (no real trades) | false |

## Usage

### First Time Setup

**Important: Start in paper trading mode to test without risk**

```bash
# Edit .env and set:
PAPER_TRADING_MODE=true

# Start the system
npm start
```

### Production Mode

**After testing thoroughly, switch to live trading:**

```bash
# Edit .env and set:
PAPER_TRADING_MODE=false

# Start the system
npm start
```

**Watch Mode (auto-restart on changes):**
```bash
npm run dev
```

### Using PM2 (Recommended for Production)

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start src/index.js --name arbitrage

# Monitor logs
pm2 logs arbitrage

# View status
pm2 status
```

### Running Tests

```bash
npm test
```

The test suite will:
1. Verify symbol mapping
2. Check configuration
3. Test exchange connections
4. Validate funding rate collection
5. Test threshold logic
6. Verify timing alignment
7. Monitor for live opportunities (30s)

## How It Works

### Complete System Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: Opportunity Detection                                  │
│  1. Bidirectional search (top 15 tokens from each exchange)     │
│  2. Funding rate comparison                                     │
│  3. Timing verification (< 60s difference)                      │
│  4. Threshold checking (> 0.1%)                                 │
└─────────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2: Position Sizing & Profitability                        │
│  1. Fetch balances from both exchanges                          │
│  2. Calculate position sizes (50% of total balance with 10x)    │
│  3. Analyze liquidity (3x multiplier required)                  │
│  4. Calculate net profit after fees (> 0.05% required)          │
└─────────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: Order Execution                                        │
│  1. Check cooldown (15 min between trades)                      │
│  2. Re-verify funding rate                                      │
│  3. Determine position sides (SHORT/LONG)                       │
│  4. Set leverage on both exchanges                              │
│  5. Place orders simultaneously                                 │
│  6. Verify fills (> 95% required)                               │
└─────────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: Real-time Trade Monitoring                             │
│  1. Connect to private WebSockets (Delta & Pi42)                │
│  2. Track position updates in real-time                         │
│  3. Verify quantities match (< 5% difference)                   │
│  4. Monitor for funding rate flip (every 5 seconds)             │
│  5. Trigger emergency exit if risks detected                    │
└─────────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 5: Intelligent Exit Logic                                 │
│  • Normal Exit:                                                 │
│    1. Wait for funding event (~8 hours)                         │
│    2. Check for funding credit (max 5 min)                      │
│    3. Place limit orders at mark price                          │
│  • Emergency Exit:                                              │
│    1. Triggered by quantity mismatch or flip detection          │
│    2. Place immediate market orders                             │
│    3. Close positions ASAP                                      │
└─────────────────────────────────────────────────────────────────┘
```

### Funding Rate Differential Calculation

The system calculates funding rate differentials based on sign combinations:

```javascript
// Both same sign (positive or negative)
diff = abs(FR_first) - abs(FR_second)

// Opposite signs
diff = abs(FR_first) + abs(FR_second)
```

Example:
- Delta: +1.0%, Pi42: -0.2% → diff = 1.2% ✅ Exceeds TH1
- Delta: +0.8%, Pi42: +0.2% → diff = 0.6% ✅ Exceeds TH2
- Delta: -0.5%, Pi42: -0.3% → diff = 0.2% ❌ Below TH2

## Symbol Mapping

The system automatically maps symbols between exchanges:

| Delta Exchange | Pi42 Exchange |
|----------------|---------------|
| BTCUSD | BTC_USDT |
| ETHUSD | ETH_USDT |
| SOLUSD | SOL_USDT |
| ADAUSD | ADA_USDT |
| ... | ... |

Additional mappings can be added in `src/utils/symbolMapper.js`.

## Output Example

```
╔════════════════════════════════════════════════════════════╗
║   CEX Funding Rate Arbitrage - All Phases Active          ║
║   Delta Exchange ⇄ Pi42                                   ║
╚════════════════════════════════════════════════════════════╝

🚀 Starting Funding Rate Arbitrage Engine - Phase 1, 2, 3, 4 & 5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Connected to Redis
✅ Connected to MongoDB
📑 MongoDB indexes created successfully
✅ Connected to Delta Exchange WebSocket
✅ Connected to Pi42 Exchange WebSocket

🔄 Initializing Trade Monitor (Phase 4)...
✅ Delta Position Monitor connected
✅ Pi42 Position Monitor connected
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Arbitrage Engine started successfully
📈 Primary Threshold (TH1): 0.1%
📊 Secondary Threshold (TH2): 0.1%
⏱️  Funding Time Window: 60s
🔧 Phase 2 Enabled: true
⚡ Phase 3 Enabled: true
📝 Paper Trading Mode: false
🔍 Trade Monitoring: ENABLED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

============================================================
🎯 PHASE 1: ARBITRAGE OPPORTUNITY DETECTED
============================================================
Token:           BTCUSDT / BTCUSDT
Funding Diff:    0.1500%
Threshold:       0.1% (primary)
Delta FR:        0.1800%
Pi42 FR:         0.0300%
Time Diff:       15.34s
Next Funding:    12/16/2025, 8:00:00 PM
============================================================

🔄 Starting Phase 2 Evaluation...
============================================================
✅ PHASE 2: ALL CHECKS PASSED
============================================================
Position Size:   $500 USD per side
Net Profit:      0.12% ($1.20)
============================================================

🚀 Proceeding to Phase 3: Order Execution...

🎯 PHASE 3: ORDER EXECUTION
============================================================
✅ Cooldown check passed
✅ Funding rate re-verified
✅ Position sides: Delta SHORT, Pi42 LONG
✅ Leverage set: 10x on both exchanges
✅ Orders placed simultaneously
✅ Delta order filled: 100%
✅ Pi42 order filled: 100%
============================================================
✅ PHASE 3: Orders executed successfully on both exchanges!

📊 PHASE 4: Registering trade for monitoring...
✅ Trade monitoring activated

🔍 QUANTITY CHECK
============================================================
Delta Quantity:  0.01 BTC
Pi42 Quantity:   0.01 BTC
Difference:      0.0000 (0.00%)
Tolerance:       5%
✅ Quantity check passed
============================================================

🔄 FLIP SAFETY CHECK
────────────────────────────────────────────────────────────
Current Delta FR:  0.1800%
Current Pi42 FR:   0.0300%
Funding Diff:      0.1500%
Threshold:         0.1%
✅ Flip check passed (0.1500% >= 0.1%)
────────────────────────────────────────────────────────────

... [8 hours later] ...

📊 PHASE 5: EXECUTING NORMAL EXIT (POST-FUNDING)
============================================================
⏳ WAITING FOR FUNDING CREDIT
Max wait time: 300s
Poll interval: 5s
============================================================

📊 Funding Credit Check:
   Delta: ✅ Credited
   Pi42:  ✅ Credited

✅ FUNDING CREDITED ON BOTH EXCHANGES
============================================================

📊 Executing limit exits on both exchanges...

📤 Exiting Delta position: BTCUSDT
   Order type: limit_order
   Side: buy
   Size: 0.01
   Exit price: 50500.00
✅ Delta exit order placed successfully

📤 Exiting Pi42 position: BTCUSDT
   Order type: LIMIT
   Side: SELL
   Quantity: 0.01
   Exit price: 50500.00
✅ Pi42 exit order placed successfully

✅ NORMAL EXIT COMPLETED SUCCESSFULLY
============================================================
   Exit Type: normal_exit
   Delta Order ID: delta_exit_789
   Pi42 Order ID: pi42_exit_012
✅ Exit result stored in MongoDB (normal_exit)
============================================================
```

## Data Storage

### Redis (Cache)
- Funding rate snapshots (TTL: 5 minutes)
- Active opportunities (TTL: 1 minute)
- Last trade decision (TTL: 1 hour)

### MongoDB (Persistence)
Collections:
- `funding_rates`: Historical funding rate data
- `opportunities`: All detected opportunities
- `trade_decisions`: Trade decision history
- `trades`: Executed trades
- `exit_results`: Exit outcomes (normal and emergency)

## Monitoring & Debugging

### Enable Detailed Logging
Set in `.env`:
```env
NODE_ENV=development
```

This will display:
- Real-time ticker updates from both exchanges
- Detailed funding rate information
- Opportunity detection logs
- All WebSocket events

### Check Data in MongoDB
```bash
mongosh
use funding-arbitrage

# View recent opportunities
db.opportunities.find().sort({timestamp: -1}).limit(10)

# View funding rate history
db.funding_rates.find({symbol: "BTCUSD"}).sort({timestamp: -1}).limit(10)

# Get opportunity statistics
db.opportunities.aggregate([
  {$group: {
    _id: null,
    avgProfit: {$avg: "$fundingDiff"},
    maxProfit: {$max: "$fundingDiff"},
    count: {$sum: 1}
  }}
])
```

### Check Data in Redis
```bash
redis-cli

# View all opportunity keys
KEYS opportunity:*

# View specific opportunity
GET opportunity:BTCUSD_1234567890

# View active opportunities sorted by profit
ZRANGE opportunities:active 0 -1 REV WITHSCORES
```

## Troubleshooting

### WebSocket Connection Issues

**Problem**: "Delta WebSocket closed, reconnecting..."
**Solution**:
- Check internet connection
- Verify Delta Exchange is accessible
- Check firewall settings

**Problem**: "Pi42 WebSocket disconnected"
**Solution**:
- Verify Pi42 is accessible
- Check if Socket.IO connection is blocked

### Redis Connection Issues

**Problem**: "Redis Client Error: connect ECONNREFUSED"
**Solution**:
```bash
# Windows: Start Memurai service
# Linux/Mac:
redis-server
```

### MongoDB Connection Issues

**Problem**: "Failed to connect to MongoDB"
**Solution**:
```bash
# Windows: Start MongoDB service
# Linux/Mac:
mongod --dbpath /path/to/data
```

## Performance Optimization

### Redis Configuration
For high-frequency trading, optimize Redis:
```bash
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
```

### MongoDB Indexing
Indexes are automatically created on:
- `exchange + symbol + timestamp`
- `timestamp`
- `profitPct`

## Documentation

For detailed documentation on each phase:

- **[PHASE3_DOCUMENTATION.md](./PHASE3_DOCUMENTATION.md)** - Complete Phase 3 (Order Execution) documentation
- **[PHASE4_5_DOCUMENTATION.md](./PHASE4_5_DOCUMENTATION.md)** - Complete Phase 4 & 5 (Monitoring & Exit) documentation
- **[SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md)** - Complete system architecture and operational guide

## Remaining Tasks

While all phases are implemented, the following enhancements are recommended:

1. **Funding Credit Verification APIs**
   - Implement actual Delta funding ledger query
   - Implement actual Pi42 funding history query
   - Currently uses placeholder logic

2. **Monitoring & Alerts**
   - Add email/Telegram notifications for trades
   - Implement dashboard for monitoring
   - Add Grafana/Prometheus metrics

3. **Advanced Features**
   - Circuit breaker for repeated failures
   - Position reconciliation job
   - Multi-exchange support (beyond Delta and Pi42)
   - Advanced risk management features

## Safety & Risk Management

### Comprehensive Safety Features

**Phase 1-2: Pre-Trade Validation**
- ✅ Funding time alignment verification
- ✅ Dual threshold system
- ✅ Liquidity requirement (3x position size)
- ✅ Net profit validation after all fees
- ✅ Position size limits (min/max)

**Phase 3: Execution Safety**
- ✅ Cooldown between trades (15 min)
- ✅ Funding rate re-verification before execution
- ✅ Separate API keys for trading
- ✅ Fill verification (95% minimum)
- ✅ Leverage safety limits

**Phase 4: Monitoring Safety**
- ✅ Real-time position tracking
- ✅ Quantity mismatch detection (5% tolerance)
- ✅ Continuous flip safety monitoring (every 5s)
- ✅ Automatic emergency exit triggering

**Phase 5: Exit Safety**
- ✅ Reduce-only flag on all exit orders
- ✅ Funding credit verification before exit
- ✅ Emergency exit fallback mechanism
- ✅ Timeout protection (5 min max wait)

### Important Notes
- **Start with paper trading mode** to test without risk
- **Test with small amounts** before scaling up
- **Monitor MongoDB logs** for trade history
- **Review exit results** regularly
- **Set conservative thresholds** initially
- **Understand all risks** before live trading

## License

ISC

## Support

For issues or questions:
1. Check troubleshooting section
2. Review MongoDB/Redis logs
3. Enable development mode for detailed logging
4. Check WebSocket connection status

## Disclaimer

This software is for educational purposes. Cryptocurrency trading involves substantial risk of loss. Test thoroughly and understand the risks before using with real funds.
