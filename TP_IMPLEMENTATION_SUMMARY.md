# TP (Take Profit) Frontend Display Implementation

## ✅ What Was Implemented

### Bot Backend (Current Codebase)
1. **MongoDB Schema** (`src/models/TPTracker.js`)
   - Stores TP values with automatic TTL expiration
   - Tracks status: active, executed, rejected, expired

2. **TP Tracker Service** (`src/services/tpTrackerService.js`)
   - saveTP() - Save or update TP in MongoDB
   - markAsExecuted() - Mark TP when trade executes
   - markAsExpired() - Mark TP when window expires
   - Auto-cleanup with MongoDB TTL

3. **Position Sizer Updates** (`src/core/positionSizer.js`)
   - Now returns TP values even when spread validation fails
   - TP included in all return statements (success or failure)

4. **Arbitrage Engine Updates** (`src/core/arbitrageEngine.js`)
   - Saves TP to MongoDB after Phase 2 (even if rejected)
   - Marks TP as executed when trade is placed
   - Imports tpTrackerService

---

## 🎯 How It Works

### Lifecycle Flow

```
1. OPPORTUNITY DETECTED (within 30-min window)
   ├─ Bot calculates TP in positionSizer.js
   ├─ Saves to MongoDB with 30-min TTL
   └─ Status: "active" or "rejected"

2. FRONTEND POLLS API
   ├─ API Backend reads from MongoDB
   ├─ Returns active TPs only
   └─ Frontend displays TP

3. TRADE EXECUTES or WINDOW EXPIRES
   ├─ Bot marks TP as "executed" or "expired"
   ├─ Frontend stops showing TP
   └─ MongoDB TTL auto-deletes after expiration
```

---

## 🗄️ MongoDB Collection Schema

### Collection: `tptrackers`

```json
{
  "_id": "ObjectId",
  "token": "BTCUSDT",
  "deltaSymbol": "BTCUSDT",
  "coindcxSymbol": "BTCUSDT",
  "deltaTP": 0.00001660,
  "coindcxTP": 0.00001650,
  "deltaSide": "buy",
  "coindcxSide": "sell",
  "fundingDiff": 0.6024,
  "spreadPercent": 0.18,
  "nextFundingTime": "2026-01-03T21:30:00Z",
  "timeToFundingMs": 1800000,
  "status": "active",
  "rejectionReason": null,
  "expiresAt": "2026-01-03T21:30:00Z",
  "createdAt": "2026-01-03T21:00:00Z",
  "updatedAt": "2026-01-03T21:00:00Z"
}
```

---

## 📊 Status Values

| Status | Meaning | Frontend Display |
|--------|---------|------------------|
| `active` | TP is valid, trade not executed | ✅ Show TP |
| `rejected` | Trade rejected (bad spread) | ⚠️ Show TP with warning |
| `executed` | Trade placed successfully | ❌ Hide TP |
| `expired` | 30-min window passed | ❌ Hide TP |

---

## 🚀 Quick Start Guide

### 1. Bot Backend (Already Done)
```bash
# No action needed - code already updated
# Just make sure MongoDB is running
mongod --dbpath /path/to/data
```

### 2. API Backend (Your Separate Backend)
```bash
# Copy TPTracker model to your API backend
cp src/models/TPTracker.js /path/to/api-backend/models/

# Create routes (see API_BACKEND_EXAMPLE.md)
# Install dependencies
npm install mongoose express cors

# Start API backend
npm start
```

### 3. Frontend
```bash
# Install axios
npm install axios

# Copy hook and component (see API_BACKEND_EXAMPLE.md)
# Import TPDisplay component in your main page
import TPDisplay from './components/TPDisplay';

# Use it
<TPDisplay />
```

---

## 📡 API Endpoints (API Backend)

### GET /api/tp/active
Get all active TPs (for current 30-min windows)

**Response:**
```json
{
  "success": true,
  "count": 1,
  "data": [{
    "token": "BTCUSDT",
    "deltaTP": 0.00001660,
    "coindcxTP": 0.00001650,
    "deltaSide": "buy",
    "coindcxSide": "sell",
    "status": "active",
    ...
  }]
}
```

### GET /api/tp/:token
Get TP for specific token

**Example:**
```bash
curl http://localhost:4000/api/tp/BTCUSDT
```

### GET /api/tp/status/:status
Get TPs by status (active, executed, rejected, expired)

**Example:**
```bash
curl http://localhost:4000/api/tp/status/executed
```

---

## 🎨 Frontend Display Logic

### When to Show TP
```javascript
// Show TP ONLY when:
if (
  tpData &&
  tpData.status === 'active' &&
  new Date(tpData.expiresAt) > new Date()
) {
  // Display TP component
}
```

### When to Hide TP
- No active TP in database
- Status is "executed" or "expired"
- expiresAt time has passed
- No opportunity detected in last scan

---

## ⏰ Auto-Cleanup

### MongoDB TTL Index
```javascript
// Automatically deletes documents after expiresAt
TPTrackerSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

### Manual Cleanup (Optional)
```javascript
// In your API backend cron job
import tpTrackerService from './services/tpTrackerService.js';

setInterval(async () => {
  await tpTrackerService.cleanupExpiredTPs();
}, 60000); // Every minute
```

---

## 🧪 Testing

### Test 1: TP Saved on Opportunity Detection
```bash
# Watch bot logs
tail -f bot.log

# Look for:
✅ TP saved to MongoDB for frontend display
```

### Test 2: TP Retrieved by API Backend
```bash
# Query MongoDB directly
mongosh
use arbitrage_bot
db.tptrackers.find({ status: "active" }).pretty()

# Query via API
curl http://localhost:4000/api/tp/active
```

### Test 3: Frontend Display
```bash
# Open browser console
# Check network tab for API calls
# Should see /api/tp/active polling every 5 seconds

# TP should appear when:
- Opportunity detected
- Within 30-min pre-funding window
- Status is "active"
```

### Test 4: TP Auto-Expiration
```bash
# Wait 30 minutes after opportunity detected
# Check MongoDB - document should auto-delete
# Frontend should stop showing TP
```

---

## 🔍 Debugging

### Check if TP is saved
```bash
mongosh
use arbitrage_bot
db.tptrackers.find().sort({ createdAt: -1 }).limit(5).pretty()
```

### Check API Backend logs
```bash
# Should see requests from frontend
GET /api/tp/active
```

### Check Frontend console
```bash
# Should see:
console.log(tpData) // { deltaTP: 0.00001660, ... }
```

---

## 📝 Key Files Modified

### Bot Backend
- ✅ `src/models/TPTracker.js` (NEW)
- ✅ `src/services/tpTrackerService.js` (NEW)
- ✅ `src/core/positionSizer.js` (MODIFIED)
- ✅ `src/core/arbitrageEngine.js` (MODIFIED)

### API Backend (To Implement)
- ⏳ `models/TPTracker.js` (copy from bot)
- ⏳ `routes/tpRoutes.js` (create)
- ⏳ `index.js` (mount routes)

### Frontend (To Implement)
- ⏳ `hooks/useTP.js` (create)
- ⏳ `components/TPDisplay.jsx` (create)

---

## ✅ Advantages of This Approach

1. **Decoupled Architecture**
   - Bot backend focuses on trading
   - API backend serves data
   - Frontend displays UI
   - Easy to scale independently

2. **Auto-Cleanup**
   - MongoDB TTL handles expiration
   - No manual deletion needed
   - Database stays clean

3. **Persistent Storage**
   - Can query historical TPs
   - Track execution patterns
   - Analyze rejected opportunities

4. **Real-time Updates**
   - Frontend polls every 5 seconds
   - Always shows latest TP
   - Immediate updates on execution

5. **Flexible Status Tracking**
   - Active, executed, rejected, expired
   - Frontend can show warnings
   - Debug failed trades easily

---

## 🚨 Important Notes

1. **MongoDB Connection**
   - Both bot backend and API backend connect to SAME MongoDB
   - Use same MONGODB_URI in both .env files

2. **TTL Index**
   - MongoDB must support TTL indexes
   - Check MongoDB version >= 3.2

3. **Time Synchronization**
   - Ensure server clocks are synchronized
   - expiresAt is calculated from current time

4. **Frontend Polling**
   - Don't poll too frequently (5 seconds is optimal)
   - Implement error handling for network issues

---

## 🎯 Next Steps

1. ✅ Bot backend implemented (DONE)
2. ⏳ Create API backend routes (see API_BACKEND_EXAMPLE.md)
3. ⏳ Create frontend component (see API_BACKEND_EXAMPLE.md)
4. ⏳ Test end-to-end flow
5. ⏳ Deploy to production

---

## 📞 Support

If you encounter issues:
1. Check MongoDB logs
2. Check bot backend logs
3. Check API backend logs
4. Check frontend console
5. Verify MongoDB connection string

---

**Implementation Complete! 🎉**

Your bot now saves TP to MongoDB, your API backend can serve it, and your frontend can display it during the 30-minute pre-funding window!
