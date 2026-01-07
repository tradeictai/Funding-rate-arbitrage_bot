# API Backend Integration Guide
# For displaying TP on frontend

## Overview
Your bot backend now saves TP values to MongoDB. Your API backend needs to read and serve this data to the frontend.

---

## MongoDB Connection (API Backend)

```javascript
// config/database.js (in your API backend)
import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected (API Backend)');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

export default connectDB;
```

---

## TP Tracker Model (API Backend)

```javascript
// models/TPTracker.js (in your API backend - same schema as bot)
import mongoose from 'mongoose';

const TPTrackerSchema = new mongoose.Schema({
  token: { type: String, required: true, index: true },
  deltaSymbol: { type: String, required: true },
  coindcxSymbol: { type: String, required: true },
  deltaTP: { type: Number, required: true },
  coindcxTP: { type: Number, required: true },
  deltaSide: { type: String, enum: ['buy', 'sell'], required: true },
  coindcxSide: { type: String, enum: ['buy', 'sell'], required: true },
  fundingDiff: { type: Number, required: true },
  spreadPercent: { type: Number, required: false },
  nextFundingTime: { type: Date, required: true },
  timeToFundingMs: { type: Number, required: true },
  status: {
    type: String,
    enum: ['active', 'executed', 'expired', 'rejected'],
    default: 'active',
    index: true
  },
  rejectionReason: { type: String, required: false },
  expiresAt: { type: Date, required: true, index: true }
}, {
  timestamps: true
});

// TTL Index
TPTrackerSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('TPTracker', TPTrackerSchema);
```

---

## API Routes (API Backend)

```javascript
// routes/tpRoutes.js (in your API backend)
import express from 'express';
import TPTracker from '../models/TPTracker.js';

const router = express.Router();

/**
 * GET /api/tp/active
 * Get all active TP values (for frontend display)
 */
router.get('/active', async (req, res) => {
  try {
    const activeTPs = await TPTracker.find({
      status: 'active',
      expiresAt: { $gt: new Date() } // Only non-expired
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: activeTPs.length,
      data: activeTPs
    });
  } catch (error) {
    console.error('Error fetching active TPs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch TP data'
    });
  }
});

/**
 * GET /api/tp/:token
 * Get TP for specific token
 */
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const tp = await TPTracker.findOne({
      token,
      status: 'active',
      expiresAt: { $gt: new Date() }
    });

    if (!tp) {
      return res.status(404).json({
        success: false,
        error: 'No active TP found for this token'
      });
    }

    res.json({
      success: true,
      data: tp
    });
  } catch (error) {
    console.error('Error fetching TP:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch TP data'
    });
  }
});

/**
 * GET /api/tp/status/:status
 * Get TPs by status (active, executed, rejected, expired)
 */
router.get('/status/:status', async (req, res) => {
  try {
    const { status } = req.params;

    const tps = await TPTracker.find({ status })
      .sort({ createdAt: -1 })
      .limit(50); // Last 50 records

    res.json({
      success: true,
      count: tps.length,
      data: tps
    });
  } catch (error) {
    console.error('Error fetching TPs by status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch TP data'
    });
  }
});

export default router;
```

---

## Mount Routes (API Backend)

```javascript
// index.js or app.js (in your API backend)
import express from 'express';
import cors from 'cors';
import connectDB from './config/database.js';
import tpRoutes from './routes/tpRoutes.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
connectDB();

// Routes
app.use('/api/tp', tpRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ API Backend running on port ${PORT}`);
});
```

---

## Frontend Integration

### React/Next.js Example

```javascript
// hooks/useTP.js (in your frontend)
import { useState, useEffect } from 'react';
import axios from 'axios';

export const useTP = () => {
  const [tpData, setTpData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchTP = async () => {
      try {
        const response = await axios.get('http://your-api-backend:4000/api/tp/active');
        if (response.data.success && response.data.data.length > 0) {
          setTpData(response.data.data[0]); // Get first active TP
        } else {
          setTpData(null); // No active TP
        }
        setLoading(false);
      } catch (err) {
        console.error('Error fetching TP:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    // Fetch immediately
    fetchTP();

    // Refresh every 5 seconds
    const interval = setInterval(fetchTP, 5000);

    return () => clearInterval(interval);
  }, []);

  return { tpData, loading, error };
};
```

### Frontend Component

```javascript
// components/TPDisplay.jsx (in your frontend)
import { useTP } from '../hooks/useTP';

export default function TPDisplay() {
  const { tpData, loading, error } = useTP();

  // Don't show anything if no active TP (not in 30-min window)
  if (!tpData || tpData.status !== 'active') {
    return null;
  }

  // Check if still within valid time window
  const now = Date.now();
  const timeRemaining = new Date(tpData.expiresAt) - now;

  if (timeRemaining <= 0) {
    return null; // Expired
  }

  const minutesRemaining = Math.floor(timeRemaining / 60000);

  return (
    <div className="tp-container">
      <div className="tp-header">
        <h3>Take Profit Target</h3>
        <span className="time-badge">{minutesRemaining}m remaining</span>
      </div>

      <div className="tp-details">
        <div className="tp-row">
          <span className="label">Token:</span>
          <span className="value">{tpData.token}</span>
        </div>

        <div className="tp-row">
          <span className="label">TP Delta ({tpData.deltaSide}):</span>
          <span className="value">${tpData.deltaTP.toFixed(8)}</span>
        </div>

        <div className="tp-row">
          <span className="label">TP CoinDCX ({tpData.coindcxSide}):</span>
          <span className="value">${tpData.coindcxTP.toFixed(8)}</span>
        </div>

        <div className="tp-row">
          <span className="label">Funding Diff:</span>
          <span className="value">{tpData.fundingDiff.toFixed(4)}%</span>
        </div>

        {tpData.spreadPercent && (
          <div className="tp-row">
            <span className="label">Spread:</span>
            <span className="value">{tpData.spreadPercent.toFixed(4)}%</span>
          </div>
        )}

        <div className="tp-row">
          <span className="label">Next Funding:</span>
          <span className="value">
            {new Date(tpData.nextFundingTime).toLocaleString()}
          </span>
        </div>

        {tpData.rejectionReason && (
          <div className="rejection-notice">
            ⚠️ Trade rejected: {tpData.rejectionReason}
          </div>
        )}
      </div>
    </div>
  );
}
```

### CSS Styling

```css
/* styles/TPDisplay.css */
.tp-container {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 20px;
  color: white;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  margin: 20px 0;
}

.tp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.time-badge {
  background: rgba(255, 255, 255, 0.2);
  padding: 5px 12px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
}

.tp-details {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 15px;
}

.tp-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.tp-row:last-child {
  border-bottom: none;
}

.label {
  font-weight: 500;
  opacity: 0.9;
}

.value {
  font-weight: 700;
  font-family: 'Courier New', monospace;
}

.rejection-notice {
  margin-top: 15px;
  padding: 10px;
  background: rgba(255, 200, 0, 0.2);
  border-radius: 6px;
  border-left: 3px solid #ffc800;
  font-size: 14px;
}
```

---

## Testing

### 1. Test API Backend

```bash
# Get all active TPs
curl http://localhost:4000/api/tp/active

# Get TP for specific token
curl http://localhost:4000/api/tp/BTCUSDT

# Get executed TPs
curl http://localhost:4000/api/tp/status/executed
```

### 2. Test Frontend
- Start your bot backend (it will save TP to MongoDB)
- Start your API backend (it will serve TP from MongoDB)
- Open your frontend (it will display TP when active)

---

## Environment Variables

### Bot Backend (.env)
```env
MONGODB_URI=mongodb://localhost:27017/arbitrage_bot
```

### API Backend (.env)
```env
MONGODB_URI=mongodb://localhost:27017/arbitrage_bot
PORT=4000
CORS_ORIGIN=http://localhost:3000
```

### Frontend (.env)
```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## Summary

### Data Flow
```
Bot Backend
  ↓ (saves TP)
MongoDB (tp_trackers collection)
  ↑ (reads TP)
API Backend
  ↓ (REST API)
Frontend (displays TP only during 30-min window)
```

### Lifecycle
1. **Opportunity Detected** → Bot saves TP to MongoDB with 30-min TTL
2. **Frontend Polls** → API backend fetches active TP every 5 seconds
3. **Trade Executes** → Bot marks TP as "executed", frontend stops showing
4. **Window Expires** → MongoDB TTL auto-deletes, frontend shows nothing

### Auto-Cleanup
- MongoDB TTL index automatically deletes expired TPs
- No manual cleanup needed
- Frontend only shows `status: 'active'` TPs
