# 💰 Margin Ratio Exit - Detailed Explanation

## Your 3 Questions Answered:

### 1️⃣ **Wallet Balance: Rigid or Fluctuating?**

**Answer: FLUCTUATING** - and that's exactly what we want! ✅

#### How It Changes:

```
Initial State (Trade Entry):
  Balance: $100
  Used Margin: $70 (70% allocated to position)
  Available: $30
  Margin Ratio: 70% ✅ SAFE

After Price Moves Against You:
  Balance: $100
  Unrealized Loss: -$15 (mark price moved badly)
  Available: $15 (reduced by loss)
  Used Margin: $85
  Margin Ratio: 85% 🚨 EXIT TRIGGERED!

After Funding Payment Received:
  Balance: $100.50 (+$0.50 funding)
  Used Margin: $70
  Available: $30.50
  Margin Ratio: 69.5% ✅ SAFE (improved!)
```

#### Why Fluctuating is GOOD:

- ✅ Real-time risk assessment (every second updated)
- ✅ Automatically accounts for unrealized PNL changes
- ✅ Includes funding payments (received/paid)
- ✅ Reflects trading fees
- ✅ Considers maintenance margin requirements

---

### 2️⃣ **Used Margin: From Wallet or Position Endpoint?**

**Answer: DUAL-METHOD APPROACH** (Primary + Fallback)

#### Method 1: Wallet-Based (PRIMARY) ⭐

```javascript
// From: GET /v2/wallet/balances (Delta)
// From: GET /exchange/v1/derivatives/futures/wallets (CoinDCX)

Used Margin = Total Balance - Available Balance

Example:
  balance: 100.00 USDT
  available_balance: 28.50 USDT
  Used Margin: 100 - 28.50 = 71.50 USDT
  Margin Ratio: 71.50 / 100 = 71.5%
```

**Why Wallet Method is Best:**

- ✅ Accounts for ALL positions (if you have multiple trades)
- ✅ Includes unrealized PNL automatically
- ✅ Same calculation exchange uses internally
- ✅ Works for both Cross and Isolated margin
- ✅ More accurate than manual calculation

#### Method 2: Position-Based (FALLBACK)

```javascript
// From: GET /v2/positions/margined (Delta)
// From: POST /exchange/v1/derivatives/futures/positions (CoinDCX)

Used Margin = position.margin (Delta direct field)
// OR for CoinDCX:
Used Margin = (position_size × entry_price) / leverage

Example:
  size: 1000 USDT
  entry_price: 0.006 USDT
  leverage: 10x
  Used Margin: (1000 × 0.006) / 10 = 0.6 USDT
```

**When Fallback is Used:**

- ⚠️ Only if wallet API fails or returns zero
- ⚠️ Less accurate (doesn't include fees, funding)
- ⚠️ Only accounts for current monitored position

#### Implementation:

```javascript
// Try wallet method first
deltaUsedMargin = deltaBalance - availableBalance; // PRIMARY

// Fallback to position if wallet fails
if (deltaBalance === 0 && this.latestDeltaPosition) {
  deltaUsedMargin = parseFloat(this.latestDeltaPosition.margin || 0); // FALLBACK
}
```

---

### 3️⃣ **Did You Create 5th Exit (Margin Exit)?**

**Answer: YES! Margin Ratio Exit is the NEW 2nd Priority Exit**

## Complete Exit Hierarchy:

```
┌────────────────────────────────────────────────────────────┐
│ EXIT PRIORITY ORDER (Top to Bottom)                       │
├────────────────────────────────────────────────────────────┤
│ 1️⃣  QUANTITY MISMATCH EXIT                                 │
│    Trigger: Position sizes don't match between exchanges  │
│    Action:  Immediate exit (fraud/error detection)        │
│    Safety:  Prevents one-sided exposure                   │
├────────────────────────────────────────────────────────────┤
│ 2️⃣  💰 MARGIN RATIO EXIT (NEW!)                            │
│    Trigger: Margin usage ≥ 85%                            │
│    Action:  Emergency exit to preserve capital            │
│    Safety:  PRIMARY protection against liquidation        │
│    Why:     You start at 70%, exits at 85% (15% buffer)  │
├────────────────────────────────────────────────────────────┤
│ 3️⃣  LIQUIDATION PROTECTION EXIT                            │
│    Trigger: Price within 30% of liquidation price         │
│    Action:  Exit before liquidation fees hit              │
│    Safety:  SECONDARY protection (price-based backup)     │
├────────────────────────────────────────────────────────────┤
│ 4️⃣  FLIP EXIT                                              │
│    Trigger: Funding rate differential < 0.05%             │
│    Action:  Exit when arbitrage opportunity disappears    │
│    Safety:  Risk management (profit protection)           │
├────────────────────────────────────────────────────────────┤
│ 5️⃣  NORMAL EXIT                                            │
│    Trigger: After funding + profit target reached         │
│    Action:  Planned exit, take profits                    │
│    Safety:  Profit-taking mechanism                       │
└────────────────────────────────────────────────────────────┘
```

## Why Margin Ratio is 2nd Priority (Not 5th):

### Exit Order Logic:

1. **Quantity Check** - Critical safety (prevents fraud/errors)
2. **💰 Margin Ratio** - Account-wide protection (main safety net)
3. **Liquidation Price** - Position-specific backup
4. **Flip Check** - Market condition monitoring
5. **Normal Exit** - Planned profit-taking

### Why This Order Makes Sense:

```
Example Scenario: Price moves sharply against you

Time 0: Entry
  ✅ Quantity matched ✅
  Margin Ratio: 70% ✅ SAFE
  Distance to Liq: 9% ✅ SAFE
  Funding Diff: 0.08% ✅ SAFE
  → Trade continues

Time 1: Price moves 5% adverse
  ✅ Quantity matched ✅
  Margin Ratio: 80% ✅ SAFE (approaching danger)
  Distance to Liq: 4% ✅ SAFE (getting closer)
  Funding Diff: 0.08% ✅ SAFE
  → Trade continues with caution

Time 2: Price moves another 3% adverse
  ✅ Quantity matched ✅
  Margin Ratio: 86% 🚨 DANGER! (crossed 85% threshold)
  Distance to Liq: 2% ⚠️ WARNING
  Funding Diff: 0.08% ✅ SAFE
  → 🚨 MARGIN RATIO EXIT TRIGGERED (saves your account!)
  → (Liquidation exit would trigger soon, but margin exit fired first)
```

---

## Technical Details:

### Margin Ratio Formula:

```javascript
Margin Ratio = Used Margin / Total Balance

Delta:
  Total Balance = wallet.balance (includes unrealized PNL)
  Available Balance = wallet.available_balance
  Used Margin = Total Balance - Available Balance
  Margin Ratio = Used Margin / Total Balance

CoinDCX: Same structure
```

### Exit Threshold:

```javascript
MARGIN_RATIO_EXIT_THRESHOLD = 0.85  // 85%

Exit Condition:
  IF (deltaMarginRatio >= 85%) OR (coindcxMarginRatio >= 85%)
  THEN → Emergency Exit Both Positions
```

### Safety Buffer:

```
Your Setup:
  Entry:     70% margin usage (you allocate 70% of funds)
  Buffer:    15% safety margin
  Exit:      85% margin usage
  Danger:    95% margin usage (near liquidation)
  Liquidate: 100% margin usage (account liquidated)

Timeline:
  70% ────→ 85% ────→ 95% ────→ 100%
  START     EXIT      DANGER    DEATH
  ✅         🚨         ⚠️        💀

  15% buffer before exit
  10% buffer after exit before danger
```

---

## Real-World Protection:

### Scenario 1: Slow Bleed (Unrealized Loss Accumulates)

```
Hour 0: Margin 70% ✅
Hour 1: Margin 75% ✅  (price moved slightly)
Hour 2: Margin 80% ✅  (price moved more)
Hour 3: Margin 85% 🚨 EXIT!  (saved with 15% buffer)
```

### Scenario 2: Flash Crash (Rapid Price Movement)

```
Second 0: Margin 70% ✅
Second 1: Margin 88% 🚨 INSTANT EXIT!  (caught immediately)
Second 2: Positions closed, saved ~12% of capital
```

### Scenario 3: Multiple Positions (Cross Margin)

```
Position A (BTCUSDT): Using 40% margin
Position B (ETHUSDT): Using 35% margin
Total Used: 75% ✅ SAFE

Position A moves bad: Now 50% margin
Total Used: 85% 🚨 EXIT BOTH POSITIONS!

Why: Account-level calculation protects ENTIRE balance
```

---

## Summary:

### Question 1: Wallet Balance Type?

**FLUCTUATING** - Updates every second with:

- Unrealized PNL changes ✅
- Funding payments ✅
- Trading fees ✅
- Maintenance margin adjustments ✅

### Question 2: Margin Source?

**Wallet API (Primary)** + Position API (Fallback)

- Wallet: `balance - available_balance` (more accurate)
- Position: `position.margin` or calculated from size/leverage

### Question 3: Exit Count?

**YES - Margin Exit is the NEW 2nd Priority Exit**

- Total: 5 exit mechanisms
- Margin Exit: 2nd in priority (after quantity check)
- Primary safety: Protects against liquidation
- Triggers at: 85% margin usage (you start at 70%)

---

## Code Location:

- **Function**: `checkMarginRatio()` in [tradeMonitor.js](src/monitors/tradeMonitor.js#L280)
- **Call Order**: In `runAllChecks()` - line 2
- **Exit Type**: `MARGIN_RATIO_EXIT`
- **Threshold**: `0.85` (85%)

---

Generated: February 22, 2026
