# Settings API Documentation

## Overview

The Funding Rate Arbitrage Bot now includes a REST API for managing configuration settings dynamically. You can update trading parameters from your frontend without restarting the bot.

## API Endpoints

**Base URL:** `http://localhost:5004`

### 1. Get Current Settings

```http
GET /api/settings
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "trading_config",
    "leverage": 10,
    "useFundPct": 0.15,
    "primaryThreshold": 0.1,
    "secondaryThreshold": 0.1,
    "preFundingWindowMinutes": 5,
    "maxPositionSizeUSD": 1000,
    "minPositionSizeUSD": 0.5,
    "minLiquidityMultiplier": 3.0,
    "maxSlippagePct": 0.1,
    "orderbookDepth": 20,
    "orderCooldownMinutes": 5,
    "updatedAt": "2025-01-15T10:30:00.000Z",
    "updatedBy": "system"
  }
}
```

---

### 2. Update Settings

```http
PUT /api/settings
Content-Type: application/json
```

**Request Body:**
```json
{
  "leverage": 15,
  "primaryThreshold": 0.15,
  "maxPositionSizeUSD": 2000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Settings updated successfully",
  "data": {
    "_id": "trading_config",
    "leverage": 15,
    "useFundPct": 0.15,
    "primaryThreshold": 0.15,
    "secondaryThreshold": 0.1,
    "preFundingWindowMinutes": 5,
    "maxPositionSizeUSD": 2000,
    "minPositionSizeUSD": 0.5,
    "minLiquidityMultiplier": 3.0,
    "maxSlippagePct": 0.1,
    "orderbookDepth": 20,
    "orderCooldownMinutes": 5,
    "updatedAt": "2025-01-15T10:35:00.000Z",
    "updatedBy": "frontend"
  },
  "modified": true
}
```

**Validation Errors:**
```json
{
  "success": false,
  "errors": [
    "leverage must be between 1 and 125",
    "maxPositionSizeUSD must be greater than minPositionSizeUSD"
  ]
}
```

---

### 3. Reset to Defaults

```http
POST /api/settings/reset
```

**Response:**
```json
{
  "success": true,
  "message": "Settings reset to defaults",
  "data": {
    "_id": "trading_config",
    "leverage": 10,
    "useFundPct": 0.15,
    ...
  }
}
```

---

### 4. Get Field Definitions

```http
GET /api/settings/fields
```

Returns all configurable fields with their constraints and descriptions.

**Response:**
```json
{
  "success": true,
  "data": {
    "leverage": {
      "type": "number",
      "min": 1,
      "max": 125,
      "default": 10,
      "description": "Trading leverage multiplier"
    },
    "useFundPct": {
      "type": "number",
      "min": 0.01,
      "max": 1.0,
      "default": 0.15,
      "description": "Percentage of available funds to use per trade"
    },
    ...
  }
}
```

---

### 5. Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "service": "Funding Rate Arbitrage Bot API"
}
```

---

## Configurable Parameters

| Parameter | Type | Min | Max | Default | Description |
|-----------|------|-----|-----|---------|-------------|
| `leverage` | number | 1 | 125 | 10 | Trading leverage multiplier |
| `useFundPct` | number | 0.01 | 1.0 | 0.15 | Percentage of funds to use per trade |
| `primaryThreshold` | number | 0.01 | 10.0 | 0.1 | Primary funding rate threshold (%) |
| `secondaryThreshold` | number | 0.01 | 10.0 | 0.1 | Secondary threshold (%) |
| `preFundingWindowMinutes` | number | 1 | 60 | 5 | Minutes before funding to enter position |
| `maxPositionSizeUSD` | number | 1 | 100000 | 1000 | Maximum position size in USD |
| `minPositionSizeUSD` | number | 0.1 | 1000 | 0.5 | Minimum position size in USD |
| `minLiquidityMultiplier` | number | 1.0 | 10.0 | 3.0 | Minimum liquidity multiplier |
| `maxSlippagePct` | number | 0.01 | 5.0 | 0.1 | Maximum acceptable slippage (%) |
| `orderbookDepth` | number | 5 | 100 | 20 | Orderbook depth levels to analyze |
| `orderCooldownMinutes` | number | 0 | 1440 | 5 | Cooldown between trades (minutes) |

---

## Frontend Integration Examples

### React Example

```javascript
// Fetch current settings
async function getSettings() {
  const response = await fetch('http://localhost:5004/api/settings');
  const data = await response.json();
  return data.data;
}

// Update settings
async function updateSettings(updates) {
  const response = await fetch('http://localhost:5004/api/settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });
  const data = await response.json();

  if (!data.success) {
    console.error('Validation errors:', data.errors);
    return null;
  }

  return data.data;
}

// Usage
const settings = await getSettings();
console.log('Current leverage:', settings.leverage);

const updated = await updateSettings({
  leverage: 15,
  maxPositionSizeUSD: 2000,
});
```

### Vanilla JavaScript Example

```javascript
// Update settings from form
document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const updates = {
    leverage: parseInt(document.getElementById('leverage').value),
    primaryThreshold: parseFloat(document.getElementById('threshold').value),
    maxPositionSizeUSD: parseFloat(document.getElementById('maxPosition').value),
  };

  try {
    const response = await fetch('http://localhost:5004/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    const data = await response.json();

    if (data.success) {
      alert('Settings updated successfully!');
    } else {
      alert('Validation errors: ' + data.errors.join(', '));
    }
  } catch (error) {
    console.error('Error updating settings:', error);
  }
});
```

### cURL Examples

```bash
# Get current settings
curl http://localhost:5004/api/settings

# Update settings
curl -X PUT http://localhost:5004/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "leverage": 15,
    "primaryThreshold": 0.15,
    "maxPositionSizeUSD": 2000
  }'

# Reset to defaults
curl -X POST http://localhost:5004/api/settings/reset

# Get field definitions
curl http://localhost:5004/api/settings/fields
```

---

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

This will install the required packages:
- `express` - REST API server
- `cors` - Cross-origin resource sharing

### 2. Start the Bot

```bash
npm start
```

The bot will:
1. Load configuration from MongoDB
2. Start the trading engine
3. Start WebSocket server on port 5003 (for dashboard)
4. Start REST API server on port 5004 (for settings management)

### 3. Verify API is Running

```bash
curl http://localhost:5004/health
```

You should see:
```json
{
  "status": "ok",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "service": "Funding Rate Arbitrage Bot API"
}
```

---

## Security Considerations

### What's Stored in MongoDB:
✅ Trading parameters (leverage, thresholds, position sizes)
✅ Non-sensitive configuration (timeouts, cooldowns)

### What's NOT Stored in MongoDB:
❌ API Keys (Delta, Pi42, CoinDCX)
❌ API Secrets
❌ Database credentials
❌ Redis passwords

**These remain in your `.env` file and are NEVER exposed via the API.**

---

## Architecture

```
┌─────────────┐      REST API      ┌─────────────┐      ┌─────────────┐
│  Frontend   │ ─────────────────> │   Express   │ ───> │   MongoDB   │
│  (React)    │                     │   Server    │      │  Settings   │
└─────────────┘                     └─────────────┘      └─────────────┘
                                           │
                                           │ Loads config
                                           ▼
                                    ┌─────────────┐
                                    │  Arbitrage  │
                                    │   Engine    │
                                    └─────────────┘
```

## Error Handling

The API returns appropriate HTTP status codes:

- `200 OK` - Request successful
- `400 Bad Request` - Validation failed
- `404 Not Found` - Endpoint not found
- `500 Internal Server Error` - Server error

All responses follow this format:

```json
{
  "success": true|false,
  "data": {...},       // On success
  "errors": [...],     // On validation failure
  "error": "message"   // On server error
}
```

---

## Next Steps

1. **Install dependencies:** `npm install`
2. **Start the bot:** `npm start`
3. **Test the API:** Open your browser to `http://localhost:5004/api/settings`
4. **Build your frontend:** Use the examples above to create a settings UI
5. **Monitor changes:** Settings are automatically saved to MongoDB and persisted across restarts

For questions or issues, please check the bot logs or contact support.
