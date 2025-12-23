# Order Placement API Fix

## Issue
Pi42 orders were failing with "400 Bad Request" error due to missing required parameters.

## Root Cause
The order placement wasn't following the exact API specifications from the official documentation.

---

## Pi42 API Fix

### Missing Required Parameters
1. **`placeType`**: Required field - must be "ORDER_FORM" or "POSITION"
2. **`marginAsset`**: Required field - must be "INR" or "USDT"

### Before (Incorrect)
```javascript
const orderData = {
  symbol: 'PEOPLEUSDT',
  side: 'SELL',
  type: 'LIMIT',
  quantity: '1643.48',
  timeInForce: 'GTC',
  postOnly: false,
  reduceOnly: false
};
// Missing: placeType and marginAsset
```

### After (Correct)
```javascript
const orderData = {
  placeType: "ORDER_FORM",        // ✅ REQUIRED
  quantity: 1643.48,               // ✅ Number format
  side: "SELL",                    // ✅ Uppercase
  symbol: "PEOPLEUSDT",
  reduceOnly: false,
  marginAsset: "USDT",             // ✅ REQUIRED (INR or USDT)
  type: "LIMIT",                   // ✅ Uppercase
  price: 0.00947                   // ✅ Required for LIMIT orders
};
```

### Key Changes
1. ✅ Added `placeType: "ORDER_FORM"`
2. ✅ Added `marginAsset` (auto-detected from symbol: INR for symbols ending in INR, USDT otherwise)
3. ✅ Convert quantity to number (not string)
4. ✅ Uppercase side and type
5. ✅ Convert price to number
6. ✅ Validate price is provided for LIMIT orders

---

## Delta API Fix

### Before (Potential Issues)
```javascript
const orderData = {
  product_id: productId,
  size: 1643.48,
  side: 'buy',
  order_type: 'limit_order',
  post_only: false,
  reduce_only: false,
  limit_price: '0.00968'
};
// Could have type inconsistencies
```

### After (Correct & Validated)
```javascript
const orderData = {
  product_id: productId,           // ✅ Required
  size: parseFloat(1643.48),       // ✅ Ensure number
  side: 'buy',                     // ✅ Lowercase
  order_type: 'limit_order',       // ✅ Correct format
  post_only: false,                // ✅ Boolean
  reduce_only: false,              // ✅ Boolean
  limit_price: '0.00968'           // ✅ String for precision
};
```

### Key Changes
1. ✅ Ensure size is parsed as float
2. ✅ Ensure side is lowercase
3. ✅ Validate limit_price is provided for limit_order type
4. ✅ Keep limit_price as string (Delta requires this for precision)
5. ✅ Added validation and better error messages

---

## API Endpoint Summary

### Pi42
- **Endpoint**: `POST /v1/order/place-order`
- **Required**: placeType, quantity, side, symbol, reduceOnly, marginAsset, type
- **Conditional**: price (for LIMIT), stopPrice (for STOP orders)

### Delta
- **Endpoint**: `POST /v2/orders`
- **Required**: product_id, size, side, order_type
- **Conditional**: limit_price (for limit_order)

---

## Parameter Format Reference

### Pi42 Order Parameters

| Parameter | Type | Required | Values | Example |
|-----------|------|----------|--------|---------|
| placeType | string | ✅ | "ORDER_FORM", "POSITION" | "ORDER_FORM" |
| quantity | number | ✅ | > 0 | 1643.48 |
| side | string | ✅ | "BUY", "SELL" | "SELL" |
| symbol | string | ✅ | Trading pair | "PEOPLEUSDT" |
| reduceOnly | boolean | ✅ | true/false | false |
| marginAsset | string | ✅ | "INR", "USDT" | "USDT" |
| type | string | ✅ | "MARKET", "LIMIT", "STOP_MARKET", "STOP_LIMIT" | "LIMIT" |
| price | number | Required for LIMIT | > 0 | 0.00947 |

### Delta Order Parameters

| Parameter | Type | Required | Values | Example |
|-----------|------|----------|--------|---------|
| product_id | number | ✅ | Product ID | 27 |
| size | number | ✅ | > 0 | 1643.48 |
| side | string | ✅ | "buy", "sell" | "buy" |
| order_type | string | ✅ | "limit_order", "market_order" | "limit_order" |
| limit_price | string | Required for limit_order | > 0 | "0.00968" |
| post_only | boolean | ❌ | true/false | false |
| reduce_only | boolean | ❌ | true/false | false |

---

## Margin Asset Detection Logic

```javascript
// Auto-detect margin asset from symbol
const marginAsset = symbol.endsWith('INR') ? 'INR' : 'USDT';
```

### Examples:
- `GRTINR` → marginAsset = "INR"
- `PEOPLEUSDT` → marginAsset = "USDT"
- `BTCUSDT` → marginAsset = "USDT"

---

## Error Handling

### Pi42 Validation
```javascript
if (orderType === 'LIMIT') {
  if (!price || price <= 0) {
    throw new Error('Price is required and must be greater than 0 for LIMIT orders');
  }
}
```

### Delta Validation
```javascript
if (orderType === 'limit_order') {
  if (!limitPrice || limitPrice <= 0) {
    throw new Error('limit_price is required and must be greater than 0 for limit_order type');
  }
}
```

---

## Testing

After these fixes, the order placement should work correctly:

```
📤 Placing order on Pi42 Exchange:
   Symbol: PEOPLEUSDT
   Side: SHORT
   Quantity: 1643.48
   Type: LIMIT
   Price: 0.00947

Placing Pi42 order with params: {
  placeType: 'ORDER_FORM',
  quantity: 1643.48,
  side: 'SELL',
  symbol: 'PEOPLEUSDT',
  reduceOnly: false,
  marginAsset: 'USDT',
  type: 'LIMIT',
  price: 0.00947
}

✅ Pi42 order placed successfully
```

---

## Documentation References

- **Pi42 API Docs**: https://docs.pi42.com/
  - POST /v1/order/place-order endpoint
  - Required parameters: placeType, marginAsset

- **Delta API Docs**: https://docs.delta.exchange/
  - POST /v2/orders endpoint
  - limit_price format requirements (string for precision)

---

## Files Modified

1. `src/services/pi42API.js` - Fixed placeOrder() method
2. `src/services/deltaAPI.js` - Enhanced placeOrder() method with validation

Both files now strictly follow the official API specifications.
