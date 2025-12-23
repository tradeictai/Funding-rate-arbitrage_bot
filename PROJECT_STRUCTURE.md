# Project Structure

Complete overview of the Funding Rate Arbitrage project files and their purposes.

## Directory Tree

```
CEX-Funding-Rate-Arbitrage/
│
├── src/                                    # Source code
│   ├── config/
│   │   └── config.js                      # Central configuration (loads from .env)
│   │
│   ├── core/
│   │   └── arbitrageEngine.js             # Main arbitrage logic & orchestration
│   │
│   ├── exchanges/
│   │   ├── deltaExchange.js               # Delta Exchange WebSocket handler
│   │   └── pi42Exchange.js                # Pi42 Exchange WebSocket handler
│   │
│   ├── services/
│   │   ├── redisService.js                # Redis caching service
│   │   └── mongoService.js                # MongoDB persistence service
│   │
│   ├── utils/
│   │   └── symbolMapper.js                # Symbol conversion (Delta ⇄ Pi42)
│   │
│   ├── test/
│   │   └── phase1-test.js                 # Comprehensive Phase 1 test suite
│   │
│   └── index.js                           # Main entry point
│
├── .env.example                           # Environment variables template
├── .env                                   # Your local environment config (git-ignored)
├── .gitignore                             # Git ignore rules
│
├── package.json                           # NPM dependencies & scripts
├── package-lock.json                      # Locked dependency versions
│
├── README.md                              # Main documentation
├── QUICKSTART.md                          # Quick start guide (5 minutes)
├── IMPLEMENTATION.md                      # Detailed implementation docs
└── PROJECT_STRUCTURE.md                   # This file
```

## File Purposes

### Core Files

#### `src/index.js`
**Purpose**: Application entry point
- Initializes ArbitrageEngine
- Sets up event handlers
- Handles graceful shutdown
- Displays periodic status updates

**Run**: `npm start`

#### `src/core/arbitrageEngine.js`
**Purpose**: Central arbitrage orchestrator
- Connects to both exchanges
- Processes funding rate data
- Detects arbitrage opportunities
- Implements Phase 1 logic:
  - Token selection
  - Timing verification
  - Threshold checking
- Emits events for opportunities

**Key Methods**:
- `start()` - Initialize and start monitoring
- `evaluateOpportunity()` - Check if token has arbitrage potential
- `calculateFundingDifference()` - Calculate funding rate differential
- `checkThresholds()` - Verify TH1/TH2 thresholds
- `handleOpportunity()` - Process valid opportunity

### Exchange Handlers

#### `src/exchanges/deltaExchange.js`
**Purpose**: Delta Exchange WebSocket connection
- Connects to `wss://socket.india.delta.exchange`
- Subscribes to v2/ticker channel
- Processes funding rate updates
- Calculates next funding time (8-hour intervals)
- Auto-reconnects on disconnect

**Emits**:
- `connected` - When WebSocket connects
- `update` - On each funding rate update
- `error` - On WebSocket errors

#### `src/exchanges/pi42Exchange.js`
**Purpose**: Pi42 Exchange Socket.IO connection
- Connects to `https://fawss.pi42.com/`
- Subscribes to markPriceArr channel
- Receives all tokens in batch
- Processes funding data for all symbols
- Auto-reconnects on disconnect

**Emits**:
- `connected` - When Socket.IO connects
- `update` - On individual token update
- `batchUpdate` - On full batch processed
- `error` - On Socket.IO errors

### Services

#### `src/services/redisService.js`
**Purpose**: High-speed data caching
- Caches funding rate data (5 min TTL)
- Stores active opportunities (1 min TTL)
- Maintains sorted set of opportunities by profit
- Stores last trade decision (1 hour TTL)

**Key Methods**:
- `storeFundingData()` - Cache funding rates
- `storeOpportunity()` - Cache opportunity
- `getTopOpportunities()` - Get best opportunities
- `storeTradeDecision()` - Cache latest decision

**Data Keys**:
```
funding:{exchange}:{symbol}    → Funding data
opportunity:{id}               → Opportunity data
opportunities:active           → Sorted set by profit%
trade:last_decision            → Last decision
```

#### `src/services/mongoService.js`
**Purpose**: Persistent data storage
- Stores historical funding rates
- Persists all opportunities
- Logs trade decisions
- Will store trades in Phase 3

**Collections**:
- `funding_rates` - Historical funding data
- `opportunities` - All detected opportunities
- `trade_decisions` - Decision history
- `trades` - Executed trades (Phase 3)

**Key Methods**:
- `storeFundingRate()` - Save funding rate
- `storeOpportunity()` - Save opportunity
- `storeTradeDecision()` - Save decision
- `getFundingRateHistory()` - Get historical data
- `getOpportunityStats()` - Get statistics

### Utilities

#### `src/utils/symbolMapper.js`
**Purpose**: Convert symbols between exchange formats

**Mappings**:
```
Delta     ←→    Pi42
BTCUSD    ←→    BTC_USDT
ETHUSD    ←→    ETH_USDT
SOLUSD    ←→    SOL_USDT
```

**Key Methods**:
- `deltaToPi42(symbol)` - Convert Delta → Pi42
- `pi42ToDelta(symbol)` - Convert Pi42 → Delta
- `isSupported(symbol)` - Check if symbol available on both
- `getSupportedDeltaSymbols()` - Get all supported symbols
- `addMapping(delta, pi42)` - Add custom mapping

### Configuration

#### `src/config/config.js`
**Purpose**: Centralized configuration management
- Loads environment variables from .env
- Provides default values
- Exports configuration object

**Configuration Sections**:
```javascript
{
  exchanges: { ... },  // Exchange URLs & credentials
  redis: { ... },      // Redis connection settings
  mongodb: { ... },    // MongoDB connection settings
  trading: { ... },    // Trading parameters (thresholds, etc.)
  env: '...'           // Environment mode
}
```

#### `.env.example` / `.env`
**Purpose**: Environment variable configuration

**Categories**:
- Exchange API credentials (Phase 2+)
- Redis connection settings
- MongoDB connection settings
- Trading parameters (leverage, thresholds)
- Environment mode

**Note**: `.env` is git-ignored for security

### Testing

#### `src/test/phase1-test.js`
**Purpose**: Comprehensive Phase 1 test suite

**Tests** (25 total):
1. ✅ Symbol Mapper (3 tests)
2. ✅ Configuration (5 tests)
3. ✅ Exchange Connections (2 tests)
4. ✅ Funding Rate Collection (2 tests)
5. ✅ Threshold Checking Logic (7 tests)
6. ✅ Timing Alignment (5 tests)
7. ✅ Opportunity Detection (1 live test)

**Run**: `npm test`

**Output**: Pass/fail status + detailed results

### Documentation

#### `README.md`
**Purpose**: Main project documentation
- Overview & features
- Installation guide
- Configuration instructions
- Usage examples
- Troubleshooting
- Phase roadmap

**Audience**: All users

#### `QUICKSTART.md`
**Purpose**: Get up and running in 5 minutes
- Prerequisite checklist
- Step-by-step setup
- Quick verification
- Common issues

**Audience**: New users wanting fast setup

#### `IMPLEMENTATION.md`
**Purpose**: Deep technical documentation
- Architecture overview
- Component descriptions
- Algorithm details
- Data flow diagrams
- Performance considerations
- Testing strategy

**Audience**: Developers & advanced users

#### `PROJECT_STRUCTURE.md`
**Purpose**: File organization reference (this file)
- Directory tree
- File purposes
- Key methods
- Quick navigation

**Audience**: Developers navigating codebase

### Package Files

#### `package.json`
**Purpose**: NPM configuration & dependencies

**Scripts**:
```json
{
  "start": "node src/index.js",
  "test": "node src/test/phase1-test.js",
  "dev": "node --watch src/index.js"
}
```

**Dependencies**:
- `ws` - WebSocket client (Delta)
- `socket.io-client` - Socket.IO client (Pi42)
- `redis` - Redis client
- `mongodb` - MongoDB driver
- `dotenv` - Environment variable loader

## File Sizes (Approximate)

```
Source Code:
├── arbitrageEngine.js     ~340 lines   (Core logic)
├── deltaExchange.js       ~240 lines   (Exchange handler)
├── pi42Exchange.js        ~180 lines   (Exchange handler)
├── redisService.js        ~230 lines   (Caching)
├── mongoService.js        ~250 lines   (Persistence)
├── symbolMapper.js        ~110 lines   (Utilities)
├── config.js              ~50 lines    (Config)
├── index.js               ~70 lines    (Entry point)
└── phase1-test.js         ~450 lines   (Tests)
                           ────────────
Total Source:              ~1,920 lines

Documentation:
├── README.md              ~850 lines   (Main docs)
├── QUICKSTART.md          ~450 lines   (Quick start)
├── IMPLEMENTATION.md      ~850 lines   (Technical docs)
└── PROJECT_STRUCTURE.md   ~400 lines   (This file)
                           ────────────
Total Docs:                ~2,550 lines

Grand Total:               ~4,470 lines
```

## Quick Navigation

### Want to...

**Understand the core logic?**
→ Read `src/core/arbitrageEngine.js`
→ Focus on `evaluateOpportunity()` method

**See how exchanges connect?**
→ Read `src/exchanges/deltaExchange.js`
→ Read `src/exchanges/pi42Exchange.js`
→ Look at WebSocket event handlers

**Understand data storage?**
→ Read `src/services/redisService.js` (caching)
→ Read `src/services/mongoService.js` (persistence)

**Change thresholds or settings?**
→ Edit `.env` file
→ Review `src/config/config.js` for structure

**Add new symbol pairs?**
→ Edit `src/utils/symbolMapper.js`
→ Use `addMapping()` method

**Run the system?**
→ Start Redis & MongoDB
→ Run `npm start`
→ Monitor console output

**Test the system?**
→ Run `npm test`
→ Review `src/test/phase1-test.js` for test details

**Debug issues?**
→ Set `NODE_ENV=development` in `.env`
→ Check console logs
→ Verify Redis/MongoDB connections

## Data Flow Visualization

```
User runs: npm start
    ↓
src/index.js initializes
    ↓
Creates ArbitrageEngine (src/core/arbitrageEngine.js)
    ↓
Engine connects to:
├─ Delta Exchange (src/exchanges/deltaExchange.js)
├─ Pi42 Exchange (src/exchanges/pi42Exchange.js)
├─ Redis (src/services/redisService.js)
└─ MongoDB (src/services/mongoService.js)
    ↓
Exchanges stream data
    ↓
Engine processes each update:
├─ Symbol mapping (src/utils/symbolMapper.js)
├─ Threshold checking
└─ Timing verification
    ↓
Opportunity detected?
    ↓
YES → Store in Redis & MongoDB
    → Log to console
    → Emit event
    ↓
NO → Continue monitoring
```

## Extending the System

### Adding New Exchange

1. Create `src/exchanges/newExchange.js`
2. Implement WebSocket connection
3. Normalize data format
4. Emit `update` events
5. Add symbol mappings to `symbolMapper.js`
6. Update `arbitrageEngine.js` to include new exchange

### Adding New Threshold

1. Update `.env` with new threshold value
2. Load in `src/config/config.js`
3. Add check in `arbitrageEngine.js` → `checkThresholds()`
4. Update tests in `src/test/phase1-test.js`

### Adding Custom Analysis

1. Subscribe to `opportunity` event in `src/index.js`:
```javascript
engine.on('opportunity', (opp) => {
  // Your custom analysis
});
```

2. Or create new service in `src/services/`
3. Import and use in arbitrageEngine

## Version Control

### Git Ignored Files

```
node_modules/        # Dependencies
.env                 # Secrets
logs/                # Runtime logs
*.log                # Log files
.DS_Store            # OS files
```

### Tracked Files

- All source code (`src/`)
- Configuration templates (`.env.example`)
- Documentation (`*.md`)
- Package definition (`package.json`)

## Development Workflow

```
1. Clone/Setup
   ├─ npm install
   ├─ copy .env.example .env
   └─ Start Redis & MongoDB

2. Development
   ├─ Make changes in src/
   ├─ Run: npm run dev (auto-restart)
   └─ Monitor console output

3. Testing
   ├─ Run: npm test
   ├─ Verify all tests pass
   └─ Check for errors

4. Production
   ├─ Set NODE_ENV=production in .env
   ├─ Run: npm start
   └─ Monitor for opportunities
```

---

**Current Phase**: Phase 1 (Complete ✅)
**Next Phase**: Phase 2 (Position Sizing & Profit Calculation)
**Total Files**: 19 files (12 source + 7 config/docs)
**Total Lines**: ~4,470 lines (code + docs)
