# Quick Start Guide - Phase 1

Get up and running with the Funding Rate Arbitrage system in 5 minutes.

## Prerequisites Checklist

- [ ] Node.js v20+ installed
- [ ] Redis 7+ running
- [ ] MongoDB 7+ running

## Step-by-Step Setup

### 1. Install Dependencies (1 minute)

```bash
cd C:\Users\My\Desktop\CEX-Funding-Rate-Arbitrage
npm install
```

### 2. Start Redis (Windows)

**Option A: Using Memurai (Recommended for Windows)**
1. Download from https://www.memurai.com/
2. Install and start the service
3. Redis will run on default port 6379

**Option B: Using Docker**
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

**Verify Redis is Running:**
```bash
# Should return PONG
redis-cli ping
```

### 3. Start MongoDB (Windows)

**Option A: MongoDB Community Edition**
1. Download from https://www.mongodb.com/try/download/community
2. Install and start MongoDB service
3. MongoDB will run on default port 27017

**Option B: Using Docker**
```bash
docker run -d -p 27017:27017 mongo:7
```

**Verify MongoDB is Running:**
```bash
# Should connect successfully
mongosh
# Then type: exit
```

### 4. Configure Environment (1 minute)

```bash
# Copy example file
copy .env.example .env
```

**For Phase 1 Testing, default settings work fine!**

No need to edit `.env` for now. Default values:
- Redis: localhost:6379
- MongoDB: localhost:27017
- Thresholds: TH1=0.75%, TH2=0.45%

### 5. Run Tests (2 minutes)

```bash
npm test
```

Expected output:
```
✅ Symbol Mapper - PASS
✅ Configuration - PASS
✅ Exchange Connections - PASS
✅ Funding Rate Collection - PASS
✅ Threshold Checking - PASS
✅ Timing Alignment - PASS
✅ Opportunity Detection - PASS

🎉 All tests passed! Phase 1 is ready.
```

### 6. Run the Application (1 minute)

```bash
npm start
```

You should see:
```
╔════════════════════════════════════════════════════════════╗
║   CEX Funding Rate Arbitrage - Phase 1                    ║
║   Delta Exchange ⇄ Pi42                                   ║
╚════════════════════════════════════════════════════════════╝

✅ Connected to Redis
✅ Connected to MongoDB
✅ Connected to Delta Exchange WebSocket
✅ Connected to Pi42 Exchange WebSocket
📈 Primary Threshold (TH1): 0.75%
📊 Secondary Threshold (TH2): 0.45%

Monitoring for opportunities...
```

## What Happens Next?

The system will:
1. ✅ Connect to both exchanges via WebSocket
2. ✅ Stream real-time funding rates
3. ✅ Detect arbitrage opportunities
4. ✅ Log opportunities that meet thresholds
5. ✅ Save data to Redis (cache) and MongoDB (persistence)

## Verify It's Working

### Check Console Output
You should see periodic updates like:
```
📨 Delta Real-Time Update
Symbol:         BTCUSD
Funding Rate:   0.0850%
Next Funding:   12/13/2025, 8:00:00 PM
```

### Check MongoDB
```bash
mongosh
use funding-arbitrage
db.funding_rates.countDocuments()
# Should show growing count
```

### Check Redis
```bash
redis-cli
KEYS funding:*
# Should show cached funding data
```

## When You See an Opportunity

```
============================================================
🎯 ARBITRAGE OPPORTUNITY DETECTED
============================================================
Token:           BTCUSD / BTC_USDT
Funding Diff:    0.8500%
Threshold:       0.75% (primary)
Delta FR:        0.9200%
Pi42 FR:         0.0700%
============================================================
✅ Decision: PROCEED_TO_PHASE_2
```

**This means Phase 1 is working perfectly!** 🎉

The system has:
- ✅ Found a token with high funding rate differential
- ✅ Verified funding times align between exchanges
- ✅ Confirmed difference exceeds threshold
- ✅ Logged the opportunity for Phase 2 implementation

## Stop the Application

Press `Ctrl+C` to gracefully shutdown:
```
⚠️  Received SIGINT signal
🛑 Stopping Arbitrage Engine...
🔌 Delta WebSocket disconnected
🔌 Pi42 WebSocket disconnected
🔌 Disconnected from Redis
🔌 Disconnected from MongoDB
✅ Arbitrage Engine stopped
```

## Common Issues

### "Redis Client Error: connect ECONNREFUSED"
**Fix**: Start Redis service
```bash
# Windows: Start Memurai from Services
# Docker: docker run -d -p 6379:6379 redis:7-alpine
```

### "Failed to connect to MongoDB"
**Fix**: Start MongoDB service
```bash
# Windows: Start MongoDB from Services
# Docker: docker run -d -p 27017:27017 mongo:7
```

### "Delta WebSocket closed, reconnecting..."
**Fix**: This is normal - the system auto-reconnects. Check your internet connection if it persists.

### No opportunities detected
**Fix**: This is normal! Opportunities depend on market conditions. The system is working if you see funding rate updates.

## Next Steps

### Analyze Historical Data

**Check detected opportunities:**
```javascript
// In mongosh
use funding-arbitrage

// Get all opportunities sorted by profit
db.opportunities.find().sort({fundingDiff: -1}).limit(10).pretty()

// Count opportunities by threshold type
db.opportunities.aggregate([
  {$group: {
    _id: "$thresholdType",
    count: {$sum: 1},
    avgDiff: {$avg: "$fundingDiff"}
  }}
])

// Get opportunities for specific token
db.opportunities.find({token: "BTCUSD"}).sort({timestamp: -1}).limit(10)
```

### Customize Thresholds

Edit `.env` to adjust sensitivity:
```env
# More aggressive (more opportunities)
PRIMARY_THRESHOLD=0.50
SECONDARY_THRESHOLD=0.30

# More conservative (fewer, higher-quality opportunities)
PRIMARY_THRESHOLD=1.00
SECONDARY_THRESHOLD=0.75
```

### Monitor Specific Tokens

Edit `src/exchanges/deltaExchange.js` (line 34):
```javascript
const symbols = [
  "BTCUSD",
  "ETHUSD",
  // Add your preferred tokens
];
```

## Ready for Phase 2?

Once you've:
- ✅ Verified Phase 1 works correctly
- ✅ Seen several opportunities detected
- ✅ Reviewed historical data in MongoDB
- ✅ Understood the opportunity detection logic

You're ready to proceed to **Phase 2: Position Sizing & Profit Calculation**!

Phase 2 will add:
- Balance checking
- Position sizing calculations
- Real-time profit estimation
- Slippage calculations
- Fee integration

## Need Help?

1. Check the main [README.md](README.md) for detailed documentation
2. Review test output: `npm test`
3. Enable development logging in `.env`: `NODE_ENV=development`
4. Check MongoDB and Redis logs

---

**Current Status**: ✅ Phase 1 Complete and Tested
**Next Phase**: 🔄 Phase 2 (Position Sizing & Profit Calculation)
