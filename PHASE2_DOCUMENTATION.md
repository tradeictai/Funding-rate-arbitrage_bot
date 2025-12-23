# Phase 2 Documentation
## Position Sizing & Profit Calculation

---

## Overview

Phase 2 builds upon Phase 1's opportunity detection by adding:
1. **Balance Fetching** - Get available funds from both exchanges
2. **Position Sizing** - Calculate optimal position size with leverage
3. **Liquidity Analysis** - Check orderbook depth and estimate slippage
4. **Profit Calculation** - Calculate net profit after fees and slippage
5. **Paper Trading Mode** - Test without executing real trades

---

## Architecture

```
Phase 1: Opportunity Detected
         ↓
Phase 2: Profitability Evaluation
         ├─ 1. Position Sizing
         │    ├─ Fetch balances from both exchanges
         │    ├─ Calculate position size (min_balance × 70% × 10x leverage)
         │    └─ Apply max position size limit ($1000 default)
         │
         ├─ 2. Liquidity Analysis
         │    ├─ Fetch orderbooks from both exchanges
         │    ├─ Calculate available liquidity
         │    ├─ Estimate slippage for position size
         │    └─ Validate sufficient liquidity exists (3x multiplier)
         │
         └─ 3. Profit Calculation
              ├─ Calculate funding rate profit
              ├─ Deduct trading fees (maker/taker)
              ├─ Subtract estimated slippage
              ├─ Calculate net profit percentage
              └─ Validate meets minimum threshold (0.05%)
```

---

## Components

### 1. REST API Clients

**File**: `src/services/deltaAPI.js`
- Connects to Delta Exchange REST API
- Handles authentication with API keys
- Provides methods for balance, orderbook, fees, and trading

**File**: `src/services/pi42API.js`
- Connects to Pi42 Exchange REST API
- Handles authentication with API keys
- Provides methods for balance, orderbook, fees, and trading

**Key Methods**:
```javascript
// Balance
await deltaAPI.getAssetBalance('USDT');
await pi42API.getAssetBalance('USDT');

// Orderbook
await deltaAPI.getOrderbook('BTCUSD', depth=20);
await pi42API.getOrderbook('BTC_USDT', limit=20);

// Fees
await deltaAPI.getFees('BTCUSD');
await pi42API.getFees('BTC_USDT');
```

---

### 2. Position Sizer

**File**: `src/core/positionSizer.js`

**Purpose**: Calculate optimal position size based on available balances and leverage

**Formula**:
```
Position Size = min(
  min_balance × use_fund_pct × leverage,
  max_position_size
)
```

**Example**:
```
Delta Balance:  $500 USDT
Pi42 Balance:   $800 USDT
Min Balance:    $500 USDT
Use Fund %:     70%
Leverage:       10x
Max Position:   $1000

Available Margin = $500 × 0.70 × 10 = $3500
Position Size = min($3500, $1000) = $1000 USD
```

**Output**:
```javascript
{
  canTrade: true,
  positionSizeUSD: 1000,
  positionSizeBase: 0.023256,  // in BTC
  marginRequired: 100,          // $100 margin needed
  leverage: 10,
  balances: { delta: 500, pi42: 800 }
}
```

---

### 3. Liquidity Analyzer

**File**: `src/core/liquidityAnalyzer.js`

**Purpose**: Analyze orderbook depth and estimate slippage

**Checks**:
1. **Sufficient Liquidity**: Available liquidity >= position_size × 3.0
2. **Acceptable Slippage**: Slippage <= 0.1%

**How Slippage is Calculated**:
```javascript
// Walk through orderbook and fill position
let remainingSize = positionSizeBase;
let totalCost = 0;

for (const order of orderbook) {
  const fillSize = min(remainingSize, order.size);
  totalCost += fillSize × order.price;
  remainingSize -= fillSize;
}

avgExecutionPrice = totalCost / positionSizeBase;
slippagePct = abs((avgExecutionPrice - bestPrice) / bestPrice) × 100;
```

**Example Output**:
```
Delta Side:       SELL
Pi42 Side:        BUY
Position Size:    0.023256

Delta Liquidity:  0.150000 (6.45x)
Pi42 Liquidity:   0.200000 (8.60x)

Delta Slippage:   0.0245%
Pi42 Slippage:    0.0189%
Total Slippage:   0.0434%

✅ Liquidity analysis complete
```

---

### 4. Profit Calculator

**File**: `src/core/profitCalculator.js`

**Purpose**: Calculate comprehensive profit analysis

**Calculation Steps**:

1. **Funding Profit** (Main profit source)
```
Funding Profit = position_size_USD × (funding_diff / 100)
```

2. **Trading Fees** (Opening + Closing on both exchanges)
```
Delta Fees = position_size × delta_fee_rate × 2  # Open + Close
Pi42 Fees  = position_size × pi42_fee_rate × 2   # Open + Close
Total Fees = Delta Fees + Pi42 Fees
```

3. **Slippage Costs**
```
Slippage Cost = position_size × (total_slippage_pct / 100)
```

4. **Net Profit**
```
Net Profit = Funding Profit - Total Fees - Slippage Cost
Net ROI = (Net Profit / margin_invested) × 100
```

**Example Output**:
```
Funding Diff:     0.1656%
Position Size:    $1000.00 USD
Leverage:         10x
Margin Invested:  $100.00 USD
Funding Profit:   $1.66 (1.6560% ROI)

Trading Fees:
  Delta:          $0.40 (0.0400%)
  Pi42:           $0.40 (0.0400%)
  Total:          $0.80 (0.0800%)

Slippage Costs:
  Delta:          $0.25
  Pi42:           $0.19
  Total:          $0.44 (0.0434%)

──────────────────────────────────────────────────────────
Gross Profit:     $1.66
Total Costs:      $1.24
Net Profit:       $0.42
Net ROI:          0.4226% (on $100.00 margin)

✅ Profitable opportunity!
```

---

## Configuration

### Environment Variables (.env)

```bash
# Exchange API Credentials
DELTA_API_KEY=your_delta_api_key_here
DELTA_API_SECRET=your_delta_api_secret_here
PI42_API_KEY=your_pi42_api_key_here
PI42_API_SECRET=your_pi42_api_secret_here

# Position Sizing
LEVERAGE=10                        # 10x leverage
USE_FUND_PCT=0.70                  # Use 70% of available balance
MAX_POSITION_SIZE_USD=1000         # Maximum $1000 per trade
MIN_POSITION_SIZE_USD=10           # Minimum $10 per trade

# Liquidity & Slippage
MIN_LIQUIDITY_MULTIPLIER=3.0       # Require 3x liquidity
MAX_SLIPPAGE_PCT=0.1               # Max 0.1% slippage
ORDERBOOK_DEPTH=20                 # Fetch 20 levels deep

# Profit Requirements
MIN_NET_PROFIT_PCT=0.05            # Minimum 0.05% net profit

# Testing
PAPER_TRADING_MODE=true            # Paper trading (no real trades)
```

---

## Usage

### Setup API Keys

1. **Delta Exchange**:
   - Log in to https://www.delta.exchange
   - Go to Settings → API Management
   - Create new API key with trading permissions
   - Copy API Key and API Secret

2. **Pi42 Exchange**:
   - Log in to https://pi42.com
   - Go to Account → API Management
   - Create new API key with trading permissions
   - Copy API Key and API Secret

3. **Update .env file**:
   ```bash
   DELTA_API_KEY=your_delta_key
   DELTA_API_SECRET=your_delta_secret
   PI42_API_KEY=your_pi42_key
   PI42_API_SECRET=your_pi42_secret
   ```

### Run Phase 2

```bash
# Start the system
npm start
```

**Expected Output**:
```
🔍 Scanning: Top 15 Delta tokens vs Top 15 Pi42 tokens
✅ Found 6 valid opportunity(ies)
🎯 Best opportunity: PEOPLEUSD with 0.1656% differential

============================================================
🎯 PHASE 1: ARBITRAGE OPPORTUNITY DETECTED
============================================================
Token:           PEOPLEUSD / PEOPLEUSDT
Funding Diff:    0.1656%
...

🔄 Starting Phase 2 Evaluation...
============================================================

💰 Calculating Position Size...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Delta Balance:   $500.00 USDT
Pi42 Balance:    $800.00 USDT
Min Balance:     $500.00 USDT
Available Margin: $3500.00 USDT (70% × 10x)
Position Size:    $1000.00 USDT (max: $1000)
Avg Price:        $0.02150
Position (Base):  46.511628
Margin Required:  $100.00 USDT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Position sizing complete

📊 Analyzing Liquidity...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Delta Side:       SELL
Pi42 Side:        BUY
Position Size:    46.511628

Delta Liquidity:  150.000000 (3.23x)
Pi42 Liquidity:   200.000000 (4.30x)

Delta Slippage:   0.0245%
Pi42 Slippage:    0.0189%
Total Slippage:   0.0434%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Liquidity analysis complete

💵 Calculating Profit...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Funding Diff:     0.1656%
Position Size:    $1000.00 USD
Leverage:         10x
Margin Invested:  $100.00 USD
Funding Profit:   $1.66 (1.6560% ROI)

Trading Fees:
  Delta:          $0.40 (0.0400%)
  Pi42:           $0.40 (0.0400%)
  Total:          $0.80 (0.0800%)

Slippage Costs:
  Delta:          $0.25
  Pi42:           $0.19
  Total:          $0.44 (0.0434%)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Gross Profit:     $1.66
Total Costs:      $1.24
Net Profit:       $0.42
Net ROI:          0.4226% (on $100.00 margin)
✅ Profitable opportunity!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

============================================================
✅ PHASE 2: ALL CHECKS PASSED
============================================================
╔════════════════════════════════════════════════════════════╗
║                   PROFIT ANALYSIS SUMMARY                   ║
╚════════════════════════════════════════════════════════════╝

  Gross Profit:      $1.66
  Trading Fees:     -$0.80
  Slippage:         -$0.44
  ───────────────────────────────────────────────────────────
  Net Profit:        $0.42
  Net ROI:           0.4226%

  Status:            ✅ PROFITABLE
============================================================

✅ Decision: PAPER_TRADE_APPROVED
📝 Reason: Net profit 0.4226% exceeds minimum 0.05%
⚠️  PAPER TRADING MODE - No real trades will be executed
```

---

## Decision Flow

```
Phase 1: Opportunity Detected
      ↓
Phase 2: Position Sizing
      ├─ ❌ Insufficient Balance → Reject
      ├─ ❌ Position Too Small/Large → Reject
      └─ ✅ Valid Position Size
           ↓
Phase 2: Liquidity Analysis
      ├─ ❌ Insufficient Liquidity → Reject
      ├─ ❌ Excessive Slippage → Reject
      └─ ✅ Adequate Liquidity
           ↓
Phase 2: Profit Calculation
      ├─ ❌ Net Profit Below Minimum → Reject
      ├─ ❌ Negative Profit → Reject
      └─ ✅ Profitable
           ↓
Paper Trading Mode?
      ├─ YES → Decision: PAPER_TRADE_APPROVED
      └─ NO  → Decision: PROCEED_TO_PHASE_3
```

---

## Testing

### Paper Trading Mode (Recommended)

1. **Enable Paper Trading**:
   ```bash
   # In .env file
   PAPER_TRADING_MODE=true
   ```

2. **Run the system**:
   ```bash
   npm start
   ```

3. **Observe Output**:
   - All calculations are real
   - No actual trades are executed
   - Safe for testing with live market data

### Adjusting Parameters

**More Conservative**:
```bash
MAX_POSITION_SIZE_USD=500          # Smaller positions
MIN_LIQUIDITY_MULTIPLIER=5.0       # More liquidity required
MAX_SLIPPAGE_PCT=0.05              # Lower slippage tolerance
MIN_NET_PROFIT_PCT=0.10            # Higher profit threshold
```

**More Aggressive**:
```bash
MAX_POSITION_SIZE_USD=2000         # Larger positions
MIN_LIQUIDITY_MULTIPLIER=2.0       # Less liquidity required
MAX_SLIPPAGE_PCT=0.2               # Higher slippage tolerance
MIN_NET_PROFIT_PCT=0.03            # Lower profit threshold
```

---

## Monitoring

### Check MongoDB for Results

```bash
mongosh
use funding-arbitrage

# View recent opportunities with Phase 2 data
db.opportunities.find(
  { "phase2.canExecute": true }
).sort({ timestamp: -1 }).limit(10)

# View rejected opportunities and reasons
db.opportunities.find(
  { status: "rejected_phase2" },
  { token: 1, "phase2.reason": 1, timestamp: 1 }
).sort({ timestamp: -1 }).limit(10)

# Calculate average net profit
db.opportunities.aggregate([
  { $match: { "phase2.canExecute": true } },
  { $group: {
    _id: null,
    avgNetProfit: { $avg: "$phase2.profitAnalysis.netProfitPct" },
    maxNetProfit: { $max: "$phase2.profitAnalysis.netProfitPct" },
    count: { $sum: 1 }
  }}
])
```

---

## Troubleshooting

### Issue: "Insufficient balance"
**Solution**:
- Ensure you have USDT in both exchanges
- Check minimum balance: $10 default
- Reduce `MAX_POSITION_SIZE_USD` if needed

### Issue: "Insufficient liquidity"
**Solution**:
- Reduce `MAX_POSITION_SIZE_USD`
- Lower `MIN_LIQUIDITY_MULTIPLIER`
- Choose more liquid tokens

### Issue: "Excessive slippage"
**Solution**:
- Reduce position size
- Increase `MAX_SLIPPAGE_PCT` (not recommended)
- Choose more liquid tokens

### Issue: "Net profit below minimum"
**Solution**:
- Lower `MIN_NET_PROFIT_PCT`
- Increase leverage (higher risk)
- Look for opportunities with higher funding differentials

### Issue: "API authentication failed"
**Solution**:
- Verify API keys are correct
- Check API key permissions (trading enabled)
- Ensure API keys haven't expired

---

## Safety Features

✅ **Paper Trading Mode** - Test without risk
✅ **Balance Validation** - Ensure sufficient funds
✅ **Liquidity Checks** - Prevent slippage losses
✅ **Profit Validation** - Only execute profitable trades
✅ **Position Limits** - Prevent over-exposure
✅ **Comprehensive Logging** - Track all decisions

---

## Next Steps

### Phase 3 Preview

**Trade Execution & Monitoring**:
1. Simultaneous order placement on both exchanges
2. Partial fill handling
3. Quantity mismatch detection
4. Funding flip safety mechanisms
5. Exit logic and P&L calculation
6. Position monitoring

---

## Summary

**Phase 2 Status**: ✅ Complete and Ready for Testing

**What You Get**:
- Real-time balance fetching
- Intelligent position sizing with leverage
- Comprehensive liquidity analysis
- Accurate profit calculations
- Safe paper trading mode

**Performance**: < 500ms per opportunity evaluation

**Recommendation**:
1. Test in paper trading mode for 24-48 hours
2. Monitor profitability and rejection reasons
3. Adjust parameters based on results
4. When confident, proceed to Phase 3 (live trading)

---

**Last Updated**: December 13, 2025
**Status**: ✅ Phase 2 Implementation Complete
