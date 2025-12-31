# Settings API - Quick Start Guide

## Overview

Your trading bot now supports **dynamic configuration management** through a REST API. You can update trading parameters from the frontend without restarting the bot!

## Architecture

```
Frontend (React)          Backend (Node.js)         Database
Port: 3000        →       Port: 5004        →       MongoDB
Settings.jsx              Express API               config_settings collection
```

## What Was Created

### Backend Files

1. **`src/models/ConfigSettings.js`**
   - Schema and validation rules for settings
   - Default configuration values

2. **`src/services/configService.js`**
   - MongoDB operations for settings
   - CRUD operations with validation

3. **`src/routes/settingsRoutes.js`**
   - REST API endpoints:
     - `GET /api/settings` - Get current settings
     - `PUT /api/settings` - Update settings
     - `POST /api/settings/reset` - Reset to defaults
     - `GET /api/settings/fields` - Get field definitions

4. **`src/server/apiServer.js`**
   - Express server running on port 5004
   - CORS enabled for frontend communication

5. **`src/config/configLoader.js`**
   - Dynamic config loader that reads from MongoDB
   - Merges database settings with environment variables
   - Keeps API keys secure in .env file

6. **Updated `src/config/config.js`**
   - Now exports dynamic config from configLoader
   - Maintains backward compatibility

7. **Updated `src/index.js`**
   - Loads config from MongoDB on startup
   - Starts both WebSocket server (5003) and API server (5004)

### Frontend Files

1. **Updated `bot_dashboard/src/pages/Settings.jsx`**
   - Fetches settings from API on load
   - Saves settings to API
   - Shows loading states and error messages
   - Includes all configurable parameters

### Documentation

1. **`API_DOCUMENTATION.md`** - Complete API reference with examples

---

## Setup & Usage

### Step 1: Install Dependencies

```bash
# In the main bot directory
npm install
```

This installs the new dependencies:
- `express` - REST API server
- `cors` - Cross-origin requests

### Step 2: Start the Bot

```bash
npm start
```

You should see:
```
📝 Loading configuration from database...
✅ Configuration loaded

🚀 Starting WebSocket server for frontend dashboard...
✅ Dashboard available at http://localhost:3000

🚀 Starting REST API server for configuration...
[API Server] REST API running on port 5004
```

### Step 3: Start the Frontend

```bash
cd bot_dashboard
npm run dev
```

Frontend will run on `http://localhost:3000`

### Step 4: Test the Integration

1. Open `http://localhost:3000` in your browser
2. Navigate to the **Settings** page
3. You should see all settings loaded from the database
4. Try changing a value (e.g., leverage from 10 to 15)
5. Click **Save Settings**
6. You should see a success message

---

## Configurable Parameters

| Parameter | Range | Description |
|-----------|-------|-------------|
| **leverage** | 1 - 125 | Trading leverage multiplier |
| **useFundPct** | 0.01 - 1.0 | Percentage of funds to use per trade |
| **primaryThreshold** | 0.01 - 10.0 | Primary funding rate threshold (%) |
| **secondaryThreshold** | 0.01 - 10.0 | Secondary threshold (%) |
| **maxPositionSizeUSD** | 1 - 100,000 | Maximum position size in USD |
| **minPositionSizeUSD** | 0.1 - 1,000 | Minimum position size in USD |
| **minLiquidityMultiplier** | 1.0 - 10.0 | Minimum liquidity safety factor |
| **maxSlippagePct** | 0.01 - 5.0 | Maximum acceptable slippage (%) |
| **orderbookDepth** | 5 - 100 | Orderbook depth levels to analyze |
| **preFundingWindowMinutes** | 1 - 60 | Minutes before funding to enter |
| **orderCooldownMinutes** | 0 - 1,440 | Cooldown between trades (minutes) |

---

## Testing the API

### Using cURL

```bash
# Get current settings
curl http://localhost:5004/api/settings

# Update settings
curl -X PUT http://localhost:5004/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "leverage": 15,
    "primaryThreshold": 0.15
  }'

# Reset to defaults
curl -X POST http://localhost:5004/api/settings/reset
```

### Using Browser

Open your browser's developer console on the Settings page:

```javascript
// Get settings
fetch('http://localhost:5004/api/settings')
  .then(r => r.json())
  .then(console.log)

// Update settings
fetch('http://localhost:5004/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ leverage: 20 })
})
  .then(r => r.json())
  .then(console.log)
```

---

## How It Works

### On Bot Startup:

1. Bot connects to MongoDB
2. Loads configuration from `config_settings` collection
3. If no config exists, creates default configuration
4. Merges MongoDB settings with .env variables
5. Starts trading engine with loaded config

### When You Update Settings:

1. Frontend sends PUT request to `/api/settings`
2. Backend validates the changes
3. If valid, saves to MongoDB
4. Returns updated configuration
5. **Changes apply to new trades immediately** (no restart needed)

### Security:

- ✅ API Keys and Secrets stay in `.env` file
- ✅ Never exposed through the API
- ✅ Only trading parameters are configurable
- ✅ All updates are validated before saving

---

## Troubleshooting

### Error: "Could not connect to API"

**Solution:** Make sure the bot is running (`npm start`)

### Error: "Failed to load settings"

**Solution:**
1. Check MongoDB is running
2. Verify MongoDB URI in `.env` file
3. Check bot console for errors

### Settings don't update

**Solution:**
1. Check for validation errors in the response
2. Ensure values are within allowed ranges
3. Check browser console for errors

### CORS errors

**Solution:** API server has CORS enabled for `localhost:3000`. If using a different port, update `src/server/apiServer.js`:

```javascript
cors({
  origin: ["http://localhost:3000", "http://localhost:YOUR_PORT"],
  credentials: true,
})
```

---

## Next Steps

1. **Test the Settings Page:** Change some values and verify they save
2. **Monitor Trades:** Check if new trades use updated parameters
3. **View API Docs:** Read `API_DOCUMENTATION.md` for complete API reference
4. **Customize:** Add more configurable parameters as needed

---

## Support

For issues or questions:
- Check the bot console logs for errors
- Review `API_DOCUMENTATION.md` for API details
- Ensure both frontend and backend are running

---

**Created:** 2025-12-31
**API Version:** 1.0
**Ports:** Frontend: 3000, WebSocket: 5003, API: 5004
