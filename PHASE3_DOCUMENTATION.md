# Phase 3: Order Execution Documentation

## Overview
Phase 3 implements automated order execution on both Delta and Pi42 exchanges with mandatory safety checks before placing any orders.

## Architecture

### New Files Created
- **`src/core/orderExecutor.js`**: Main order execution module with all Phase 3 logic

### Modified Files
- **`src/core/arbitrageEngine.js`**: Integrated Phase 3 execution after Phase 2 approval
- **`src/index.js`**: Updated headers to reflect Phase 3

## Execution Flow

### 1. Entry Point
Phase 3 is triggered automatically when:
- Phase 2 completes successfully (profitable opportunity found)
- `phase3Enabled = true` in the engine
- `paperTradingMode = false` (real trading mode)

### 2. Mandatory Pre-Execution Checks

#### Check 1: Funding Rate Re-verification
**Purpose**: Ensure the funding rate differential still exceeds the threshold before placing orders

**Implementation**:
```javascript
recheckFundingRate(deltaData, pi42Data, threshold)
```

**Process**:
1. Fetch fresh funding rate data from both exchanges
2. Recalculate funding rate differential using Phase 1 logic
3. Compare against the original threshold (TH1 or TH2)
4. If funding rate has changed significantly, abort execution

**Pass Criteria**:
- `fundingDiff >= threshold`

#### Check 2: Position Side Determination (Common Mapping)
**Purpose**: Determine whether to go LONG or SHORT on each exchange

**Implementation**:
```javascript
determinePositionSides(FR_first, exchange_first, exchange_second)
```

**Common Mapping Rules**:

| Scenario | FR_first Sign | Exchange_first | Action on EX1 | Action on EX2 |
|----------|---------------|----------------|---------------|---------------|
| 1 | Positive (+) | Delta | SHORT (sell) | LONG (buy) |
| 2 | Positive (+) | Pi42 | LONG (buy) | SHORT (sell) |
| 3 | Negative (-) | Delta | LONG (buy) | SHORT (sell) |
| 4 | Negative (-) | Pi42 | SHORT (sell) | LONG (buy) |

**Example**:
- If Delta has funding rate of +0.15% and Pi42 has +0.05%
- `FR_first = 0.15%` (Delta, positive)
- `exchange_first = 'delta'`
- Result: **SHORT on Delta**, **LONG on Pi42**

### 3. Order Placement

#### Delta Exchange Order
**Function**: `placeOrderOnDelta(symbol, side, quantity, price, orderType)`

**Parameters**:
- `symbol`: Delta symbol (e.g., 'BTCUSD')
- `side`: 'LONG' or 'SHORT'
- `quantity`: Contract quantity from Phase 2
- `price`: Trading price from Phase 2
- `orderType`: 'market_order' or 'limit_order'

**API Endpoint**: `POST https://api.india.delta.exchange/v2/orders`

**Request Format**:
```javascript
{
  product_id: <product_id>,
  size: <quantity>,
  side: 'buy' | 'sell',  // Converted from LONG/SHORT
  order_type: 'limit_order' | 'market_order',
  limit_price: <price>,  // For limit orders
  post_only: false,
  reduce_only: false
}
```

#### Pi42 Exchange Order
**Function**: `placeOrderOnPi42(symbol, side, quantity, price, orderType)`

**Parameters**:
- `symbol`: Pi42 symbol (e.g., 'GRTINR')
- `side`: 'LONG' or 'SHORT'
- `quantity`: Contract quantity from Phase 2
- `price`: Trading price from Phase 2
- `orderType`: 'MARKET' or 'LIMIT'

**API Endpoint**: `POST https://fapi.pi42.com/v1/order/place-order`

**Request Format**:
```javascript
{
  placeType: "ORDER_FORM",
  quantity: <quantity>,
  side: 'BUY' | 'SELL',  // Converted from LONG/SHORT
  symbol: <symbol>,
  type: 'MARKET' | 'LIMIT',
  price: <price>,  // For limit orders
  reduceOnly: false,
  marginAsset: 'INR'
}
```

### 4. Execution Strategy

Orders are placed **in parallel** using `Promise.all()`:
```javascript
const [deltaOrder, pi42Order] = await Promise.all([
  placeOrderOnDelta(...),
  placeOrderOnPi42(...)
]);
```

**Benefits**:
- Minimizes timing risk between orders
- Reduces exposure to market movements
- Faster execution

### 5. Result Handling

#### Success Case
If both orders succeed:
- Status: `opportunity.status = 'executed'`
- Decision: `decision.decision = 'EXECUTED'`
- Execution result stored in `opportunity.phase3`
- Logged to MongoDB for record-keeping

#### Failure Cases

| Failure Stage | Status | Action |
|--------------|--------|--------|
| Funding re-check fails | `funding_recheck` | Abort, no orders placed |
| Delta order fails | `order_placement` | Record partial failure |
| Pi42 order fails | `order_placement` | Record partial failure |
| Both orders fail | `order_placement` | Record complete failure |
| Unexpected error | `execution_error` | Record error details |

## Configuration

### Enable/Disable Phase 3
In `src/core/arbitrageEngine.js`:
```javascript
this.phase3Enabled = true;  // Set to false to disable Phase 3
```

### Paper Trading Mode
In `.env` or `src/config/config.js`:
```javascript
PAPER_TRADING_MODE=true   // No real orders
PAPER_TRADING_MODE=false  // Real orders (Phase 3 executes)
```

## Data Flow

```
Phase 2 Success
    ↓
Get Fresh Funding Data
    ↓
Mandatory Check 1: Re-check Funding Rate
    ↓ (Pass)
Mandatory Check 2: Determine Position Sides
    ↓
Place Orders in Parallel
    ├─→ Delta Exchange
    └─→ Pi42 Exchange
    ↓
Both Succeed?
    ├─→ Yes: Mark as EXECUTED
    └─→ No: Mark as EXECUTION_FAILED
    ↓
Store Results in MongoDB
    ↓
Emit Decision Event
```

## Example Execution Log

```
🎯 PHASE 3: ORDER EXECUTION
============================================================

📊 Step 1: Re-checking funding rate...
   ✅ Funding rate still valid: 0.1234%
   Delta FR: 0.1500%
   Pi42 FR: 0.0266%

📊 Step 2: Determining position sides...
   FR_first (0.1500%) is positive → SHORT on Delta, LONG on Pi42
   Delta Position: SHORT
   Pi42 Position: LONG

📊 Step 3: Placing orders on both exchanges...
   Delta: SHORT 100 @ 43000
   Pi42: LONG 38 @ 11.9

📤 Placing order on Delta Exchange:
   Symbol: BTCUSD
   Side: SHORT
   Quantity: 100
   Type: limit_order
   Price: 43000
✅ Delta order placed successfully

📤 Placing order on Pi42 Exchange:
   Symbol: GRTINR
   Side: LONG
   Quantity: 38
   Type: LIMIT
   Price: 11.9
✅ Pi42 order placed successfully

✅ Both orders placed successfully!
============================================================

✅ PHASE 3: Orders executed successfully on both exchanges!
```

## Safety Features

1. **Funding Rate Re-verification**: Prevents execution if market conditions changed
2. **Fresh Data Requirement**: Always uses latest funding data before execution
3. **Parallel Execution**: Minimizes timing risk
4. **Error Handling**: Graceful failure with detailed logging
5. **Paper Trading Mode**: Test without real money
6. **Complete Audit Trail**: All executions logged to MongoDB

## Testing

### Enable Paper Trading Mode
Set in `.env`:
```
PAPER_TRADING_MODE=true
```

This will:
- Execute Phases 1 & 2 normally
- Skip Phase 3 order execution
- Log all decisions as 'PAPER_TRADE_APPROVED'

### Enable Real Trading
Set in `.env`:
```
PAPER_TRADING_MODE=false
```

**WARNING**: This will place real orders with real money. Ensure:
- API keys have correct permissions
- Sufficient balance on both exchanges
- You understand the risks of automated trading

## API Requirements

### Delta Exchange API
Required permissions:
- `orders.create` - Place orders
- `wallet.read` - Check balance
- `positions.read` - Monitor positions

### Pi42 Exchange API
Required permissions:
- Order placement
- Wallet balance reading
- Position monitoring

## Monitoring

The engine emits events for monitoring:

```javascript
engine.on('opportunity', (opportunity) => {
  // Opportunity detected
  console.log(opportunity.phase3); // Execution result
});

engine.on('decision', (decision) => {
  // Decision made
  if (decision.decision === 'EXECUTED') {
    console.log('Orders executed successfully!');
  }
});
```

## Future Enhancements

Potential improvements:
1. **Partial Fill Handling**: Monitor order fills and handle partial executions
2. **Position Monitoring**: Track open positions after execution
3. **Risk Management**: Add position limits and exposure controls
4. **Execution Analytics**: Track slippage, fill rates, execution time
5. **Smart Order Routing**: Choose between market/limit orders dynamically
6. **Rollback Mechanism**: Close positions if one exchange fails

## Troubleshooting

### Orders Not Executing
- Check `paperTradingMode` is set to `false`
- Verify `phase3Enabled = true`
- Ensure API keys have order placement permissions
- Check sufficient balance on both exchanges

### Funding Re-check Failing
- Market volatility caused funding rates to change
- Increase the time between Phase 2 and Phase 3
- Consider adjusting thresholds

### Partial Order Failures
- Check API error messages
- Verify order parameters (min/max size limits)
- Ensure leverage is set correctly
- Check exchange-specific requirements

## Support

For issues or questions:
- Check logs in MongoDB for detailed execution history
- Review Redis cache for real-time data
- Examine console output for error messages
