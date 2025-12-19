# Phase 3 Updates: Separate Trade API Keys & Order Cooldown

## Overview
This document describes the updates made to Phase 3 to support:
1. **Separate API keys for order placement** - Use dedicated trading API keys different from data fetching keys
2. **15-minute cooldown period** - Prevent placing new orders within 15 minutes of the last successful execution

---

## 1. Separate Trade API Keys

### Why Separate Keys?
- **Security**: Keep trading permissions isolated from read-only data access
- **Risk Management**: Limit exposure if one set of credentials is compromised
- **Rate Limiting**: Separate rate limits for trading vs data fetching
- **Permissions**: Fine-grained control over what each API key can do

### Configuration

Add these new environment variables to your `.env` file:

```bash
# Regular API keys (for market data, balances, positions)
DELTA_API_KEY=your_delta_api_key
DELTA_API_SECRET=your_delta_api_secret
PI42_API_KEY=your_pi42_api_key
PI42_API_SECRET=your_pi42_api_secret

# Trade API keys (for order placement only)
DELTA_API_KEY_trade=your_delta_trading_api_key
DELTA_API_SECRET_trade=your_delta_trading_api_secret
PI42_API_KEY_trade=your_pi42_trading_api_key
PI42_API_SECRET_trade=your_pi42_trading_api_secret
```

### Implementation Details

#### Delta Exchange (`src/services/deltaAPI.js`)
```javascript
class DeltaAPI {
  constructor() {
    // Regular API keys for data fetching
    this.apiKey = config.exchanges.delta.apiKey;
    this.apiSecret = config.exchanges.delta.apiSecret;

    // Separate API keys for trading
    this.apiKeyTrade = config.orderPlace.delta.apiKey;
    this.apiSecretTrade = config.orderPlace.delta.apiSecret;
  }

  // request() method now accepts useTradeCreds parameter
  async request(method, endpoint, body = null, useTradeCreds = false) {
    const apiKey = useTradeCreds ? this.apiKeyTrade : this.apiKey;
    const apiSecret = useTradeCreds ? this.apiSecretTrade : this.apiSecret;
    // ... rest of implementation
  }

  // placeOrder() now uses trade credentials
  async placeOrder(orderParams) {
    // ... order setup
    const data = await this.request('POST', '/v2/orders', orderData, true);
    return data.result;
  }
}
```

#### Pi42 Exchange (`src/services/pi42API.js`)
```javascript
class Pi42API {
  constructor() {
    // Regular API keys for data fetching
    this.apiKey = config.exchanges.pi42.apiKey;
    this.apiSecret = config.exchanges.pi42.apiSecret;

    // Separate API keys for trading
    this.apiKeyTrade = config.orderPlace.pi42.apiKey;
    this.apiSecretTrade = config.orderPlace.pi42.apiSecret;
  }

  // request() method now accepts useTradeCreds parameter
  async request(method, endpoint, params = {}, useTradeCreds = false) {
    const apiKey = useTradeCreds ? this.apiKeyTrade : this.apiKey;
    const apiSecret = useTradeCreds ? this.apiSecretTrade : this.apiSecret;
    // ... rest of implementation
  }

  // placeOrder() now uses trade credentials
  async placeOrder(orderParams) {
    // ... order setup
    const data = await this.request('POST', '/v1/order', orderData, true);
    return data;
  }
}
```

### What Uses Which Keys?

| Operation | API Keys Used |
|-----------|---------------|
| Get wallet balance | Regular keys |
| Get orderbook | Regular keys |
| Get positions | Regular keys |
| Get funding rates (WebSocket) | Regular keys |
| **Place orders** | **Trade keys** |
| Cancel orders | Trade keys |
| Get open orders | Regular keys |

---

## 2. Order Cooldown Period (15 Minutes)

### Why Cooldown?
- **Risk Management**: Prevent rapid-fire order placement
- **Market Impact**: Allow time for positions to settle
- **Strategy Validation**: Ensure each trade is properly evaluated
- **Error Recovery**: Prevent cascading failures from repeated executions

### Configuration

Add to your `.env` file:

```bash
# Order execution cooldown (in minutes)
ORDER_COOLDOWN_MINUTES=15
```

Default: **15 minutes** (if not specified)

### Implementation Details

#### Order Executor (`src/core/orderExecutor.js`)

```javascript
class OrderExecutor {
  constructor() {
    this.orderCooldownMinutes = config.trading.orderCooldownMinutes; // 15 minutes
    this.lastExecutionTime = null; // Track last successful order
  }

  /**
   * Check if we are in cooldown period
   */
  checkCooldown() {
    if (!this.lastExecutionTime) {
      return { inCooldown: false, message: 'No previous executions' };
    }

    const timeSinceLastExecution = Date.now() - this.lastExecutionTime;
    const cooldownMs = this.orderCooldownMinutes * 60 * 1000;

    if (timeSinceLastExecution < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - timeSinceLastExecution) / 60000);

      return {
        inCooldown: true,
        remainingMinutes,
        message: `Cooldown active: ${remainingMinutes} minute(s) remaining`
      };
    }

    return { inCooldown: false, message: 'Cooldown period completed' };
  }
}
```

### Execution Flow

```
Opportunity Detected (Phase 1 & 2 pass)
    ↓
Check 0: Cooldown Period
    ├─→ In cooldown? → Reject with time remaining
    └─→ Not in cooldown? → Continue
    ↓
Check 1: Re-check Funding Rate
    ↓
Check 2: Determine Position Sides
    ↓
Place Orders on Both Exchanges
    ↓
Both Orders Successful?
    ├─→ Yes: Update lastExecutionTime → Start 15-min cooldown
    └─→ No: Do NOT update cooldown (allow retry)
```

### Example Execution Log

```
⏱️  Step 0: Checking cooldown period...
   ✅ No previous executions - Ready to execute

📊 Step 1: Re-checking funding rate...
   ✅ Funding rate still valid: 0.1234%

📊 Step 2: Determining position sides...
   ...

📊 Step 3: Placing orders on both exchanges...
   ...

✅ Both orders placed successfully!

⏱️  Cooldown activated: 15 minutes
   Next order available at: 12/14/2025, 3:45:00 PM
```

### During Cooldown

If another opportunity is detected during the cooldown period:

```
⏱️  Step 0: Checking cooldown period...
   ❌ Cooldown active: 12 minute(s) remaining
   Last execution: 12/14/2025, 3:30:00 PM
   Time remaining: 12 minute(s) (720 seconds)

Decision: EXECUTION_FAILED (cooldown_check)
Reason: Cooldown active: 12 minute(s) remaining
```

---

## Configuration Summary

### config.js Updates

```javascript
const config = {
  // Exchange API keys (data fetching)
  exchanges: {
    delta: {
      apiKey: process.env.DELTA_API_KEY,
      apiSecret: process.env.DELTA_API_SECRET
    },
    pi42: {
      apiKey: process.env.PI42_API_KEY,
      apiSecret: process.env.PI42_API_SECRET
    }
  },

  // NEW: Trade API keys (order placement)
  orderPlace: {
    delta: {
      apiKey: process.env.DELTA_API_KEY_trade,
      apiSecret: process.env.DELTA_API_SECRET_trade
    },
    pi42: {
      apiKey: process.env.PI42_API_KEY_trade,
      apiSecret: process.env.PI42_API_SECRET_trade
    }
  },

  trading: {
    // ... other trading params ...

    // NEW: Order execution cooldown
    orderCooldownMinutes: parseInt(process.env.ORDER_COOLDOWN_MINUTES) || 15
  }
};
```

---

## Files Modified

### 1. `src/config/config.js`
- Added `orderPlace` section with trade API keys
- Added `orderCooldownMinutes` to trading config

### 2. `src/services/deltaAPI.js`
- Added `apiKeyTrade` and `apiSecretTrade` properties
- Modified `generateSignature()` to accept custom secret
- Modified `request()` to accept `useTradeCreds` parameter
- Updated `placeOrder()` to use trade credentials

### 3. `src/services/pi42API.js`
- Added `apiKeyTrade` and `apiSecretTrade` properties
- Modified `generateSignature()` to accept custom secret
- Modified `request()` to accept `useTradeCreds` parameter
- Updated `placeOrder()` to use trade credentials

### 4. `src/core/orderExecutor.js`
- Added `orderCooldownMinutes` and `lastExecutionTime` properties
- Added `checkCooldown()` method
- Updated `executeArbitrageTrade()` to:
  - Check cooldown before execution
  - Update `lastExecutionTime` after successful orders

### 5. `.env.example`
- Added trade API key environment variables
- Added `ORDER_COOLDOWN_MINUTES` configuration

---

## Usage Examples

### Setting Different Cooldown Periods

In `.env`:
```bash
# Quick testing (1 minute)
ORDER_COOLDOWN_MINUTES=1

# Conservative trading (30 minutes)
ORDER_COOLDOWN_MINUTES=30

# Very conservative (1 hour)
ORDER_COOLDOWN_MINUTES=60

# Default (15 minutes) - if not specified
# ORDER_COOLDOWN_MINUTES=15
```

### Testing

#### 1. Test with Short Cooldown
```bash
ORDER_COOLDOWN_MINUTES=1  # 1 minute for testing
PAPER_TRADING_MODE=true
```

#### 2. Monitor Cooldown Status
The system will log:
- When cooldown starts (after successful orders)
- When opportunities are rejected due to cooldown
- Time remaining until next order

#### 3. Verify Trade API Keys
Check console logs for:
```
🔑 Using trade API credentials for Delta order placement
🔑 Using trade API credentials for Pi42 order placement
```

---

## Security Best Practices

### API Key Separation

1. **Create separate API keys** on each exchange:
   - **Read-only key**: For market data, balances (set in `DELTA_API_KEY`, `PI42_API_KEY`)
   - **Trading key**: For order placement only (set in `DELTA_API_KEY_trade`, `PI42_API_KEY_trade`)

2. **Permissions**:
   - Read-only keys: `read` permissions only
   - Trading keys: `trade` permissions (order placement, cancellation)

3. **Whitelist IPs** (if supported by exchange):
   - Restrict API keys to your server's IP address

4. **Rotate keys regularly**:
   - Change API keys periodically
   - Immediately rotate if compromised

### Environment Variables

1. **Never commit `.env` to git**:
   - Already in `.gitignore`
   - Use `.env.example` as template only

2. **Secure storage**:
   - Keep `.env` file with restricted permissions
   - Use environment variable management tools in production

---

## Troubleshooting

### Orders Still Using Regular Keys

**Symptom**: Not seeing "Using trade API credentials" in logs

**Solution**:
1. Check `.env` file has trade keys defined
2. Restart the application to reload config
3. Verify config.js is reading the correct variables

### Cooldown Not Working

**Symptom**: Multiple orders placed within 15 minutes

**Solution**:
1. Check `ORDER_COOLDOWN_MINUTES` is set in `.env`
2. Verify config is loading correctly
3. Check logs for cooldown check messages

### Authentication Errors

**Symptom**: "Delta API Error: Invalid signature" or "Pi42 API Error: Unauthorized"

**Solution**:
1. Verify trade API keys are correct
2. Ensure API keys have trading permissions
3. Check if keys are properly formatted (no extra spaces)
4. Verify timestamp synchronization

---

## Summary

These updates provide:
✅ **Enhanced Security**: Separate credentials for data vs trading
✅ **Risk Control**: 15-minute cooldown prevents rapid executions
✅ **Flexibility**: Configurable cooldown period
✅ **Transparency**: Clear logging of credential usage and cooldown status

The system now requires **8 API keys** (4 pairs):
- 2 regular keys (Delta + Pi42) for data fetching
- 2 trade keys (Delta + Pi42) for order placement
- Each with separate API key + secret

All orders are automatically subject to the 15-minute cooldown after successful execution.
