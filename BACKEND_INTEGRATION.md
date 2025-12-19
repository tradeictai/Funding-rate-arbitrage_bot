# Backend Integration Guide

This guide shows you how to connect the frontend dashboard to your existing arbitrage bot backend.

## Step 1: Install Socket.IO in Backend

Navigate to your backend project:

```bash
cd C:\Users\My\Desktop\CEX-Funding-Rate-Arbitrage
npm install socket.io
```

## Step 2: Create WebSocket Server

Create a new file in your backend:

**File: `src/server/websocketServer.js`**

```javascript
import { Server } from 'socket.io'
import http from 'http'

class WebSocketServer {
  constructor(arbitrageEngine) {
    this.engine = arbitrageEngine
    this.server = null
    this.io = null
  }

  start(port = 5000) {
    this.server = http.createServer()
    this.io = new Server(this.server, {
      cors: {
        origin: 'http://localhost:3000',
        methods: ['GET', 'POST']
      }
    })

    this.setupEventHandlers()

    this.server.listen(port, () => {
      console.log(`✅ WebSocket server running on port ${port}`)
    })
  }

  setupEventHandlers() {
    console.log('🔌 Setting up WebSocket event handlers...')

    // ==========================================
    // 1. FUNDING RATE UPDATES (Live Monitoring)
    // ==========================================

    // Delta Exchange funding rates
    this.engine.deltaExchange.on('update', (data) => {
      this.io.emit('fundingRate:delta', {
        symbol: data.symbol,
        fundingRate: data.fundingRate,
        markPrice: data.markPrice,
        nextFundingTime: data.nextFundingTime
      })
    })

    // Pi42 Exchange funding rates
    this.engine.pi42Exchange.on('update', (data) => {
      this.io.emit('fundingRate:pi42', {
        symbol: data.symbol,
        fundingRate: data.fundingRate,
        markPrice: data.markPrice,
        nextFundingTime: data.nextFundingTime
      })
    })

    // ==========================================
    // 2. OPPORTUNITY DETECTION
    // ==========================================

    this.engine.on('opportunity', (opportunity) => {
      console.log('📊 Emitting opportunity to frontend:', opportunity.token)
      this.io.emit('opportunity:detected', {
        token: opportunity.token,
        pi42Symbol: opportunity.pi42Symbol,
        FR_delta: opportunity.FR_delta,
        FR_pi42: opportunity.FR_pi42,
        fundingDiff: opportunity.fundingDiff,
        threshold: opportunity.threshold,
        thresholdType: opportunity.thresholdType,
        FT_delta: opportunity.FT_delta,
        FT_pi42: opportunity.FT_pi42,
        price_delta: opportunity.price_delta,
        price_pi42: opportunity.price_pi42,
        timestamp: opportunity.timestamp
      })
    })

    // ==========================================
    // 3. ORDER EXECUTION
    // ==========================================

    this.engine.on('decision', (decision) => {
      if (decision.decision === 'EXECUTED' && decision.executionResult?.success) {
        console.log('✅ Emitting executed order to frontend:', decision.opportunity.token)

        const opp = decision.opportunity
        const exec = decision.executionResult

        this.io.emit('order:executed', {
          token: opp.token,
          deltaSymbol: opp.token,
          pi42Symbol: opp.pi42Symbol,
          deltaSide: exec.deltaOrder.side,
          pi42Side: exec.pi42Order.side,
          deltaOrderId: exec.deltaOrder.orderId,
          pi42OrderId: exec.pi42Order.orderId,
          entryTime: Date.now(),
          fundingDiff: opp.fundingDiff,
          nextFundingTime: opp.FT_pi42
        })
      }
    })

    // ==========================================
    // 4. POSITION MONITORING (Real-time updates)
    // ==========================================

    if (this.engine.tradeMonitor) {
      // Delta position updates
      this.engine.tradeMonitor.deltaMonitor.on('position', (data) => {
        if (data.type === 'update' || data.type === 'snapshot') {
          this.io.emit('position:update', {
            exchange: 'delta',
            token: data.position.product_symbol,
            position: {
              product_symbol: data.position.product_symbol,
              product_id: data.position.product_id,
              size: data.position.size,
              entry_price: data.position.entry_price,
              mark_price: data.position.mark_price,
              unrealized_pnl: data.position.unrealized_pnl,
              margin: data.position.margin,
              product: data.position.product
            }
          })
        }
      })

      // Pi42 position updates
      this.engine.tradeMonitor.pi42Monitor.on('position', (data) => {
        if (data.type === 'update' || data.type === 'snapshot' || data.type === 'new') {
          this.io.emit('position:update', {
            exchange: 'pi42',
            token: data.position.symbol || data.position.contractPair,
            position: {
              symbol: data.position.symbol,
              contractPair: data.position.contractPair,
              positionId: data.position.positionId,
              positionAmount: data.position.positionAmount,
              positionType: data.position.positionType,
              entryPrice: data.position.entryPrice,
              markPrice: data.position.markPrice,
              unrealisedPnl: data.position.unrealisedPnl,
              quantity: data.position.quantity
            }
          })
        }
      })

      // ==========================================
      // 5. QUANTITY MISMATCH ALERTS
      // ==========================================

      this.engine.tradeMonitor.on('quantityMismatch', (data) => {
        console.log('⚠️  Emitting quantity mismatch alert to frontend')
        this.io.emit('alert:quantityMismatch', {
          timestamp: Date.now(),
          reason: `Quantity mismatch: Delta ${data.deltaQty?.toFixed(4)} vs Pi42 ${data.pi42Qty?.toFixed(4)}`,
          details: {
            deltaQuantity: data.deltaQty,
            pi42Quantity: data.pi42Qty,
            qtyDiffPct: data.differencePct
          }
        })
      })

      // ==========================================
      // 6. FLIP DETECTION ALERTS
      // ==========================================

      this.engine.tradeMonitor.on('flip', (data) => {
        console.log('⚠️  Emitting flip detection alert to frontend')
        this.io.emit('alert:flip', {
          timestamp: Date.now(),
          reason: `Funding flip detected: Current diff ${data.fundingDiff?.toFixed(4)}% < threshold ${data.threshold}%`,
          details: {
            currentDiff: data.fundingDiff,
            threshold: data.threshold,
            deltaFR: data.FR_delta,
            pi42FR: data.FR_pi42
          }
        })
      })

      // ==========================================
      // 7. EMERGENCY EXIT EVENTS
      // ==========================================

      this.engine.tradeMonitor.on('emergencyExit', (exitData) => {
        console.log('🚨 Emitting emergency exit to frontend')
        this.io.emit('alert:emergencyExit', {
          timestamp: Date.now(),
          reason: exitData.reason,
          details: exitData.details
        })
      })

      // ==========================================
      // 8. NORMAL EXIT EVENTS
      // ==========================================

      this.engine.tradeMonitor.on('normalExit', (exitData) => {
        console.log('✅ Emitting normal exit to frontend')
        this.io.emit('position:closed', {
          timestamp: Date.now(),
          token: exitData.deltaPosition?.product_symbol,
          exitType: 'normal',
          reason: exitData.reason
        })
      })
    }

    // ==========================================
    // CONNECTION HANDLING
    // ==========================================

    this.io.on('connection', (socket) => {
      console.log('✅ Frontend connected:', socket.id)

      // Send initial data when frontend connects
      socket.emit('connected', {
        message: 'Connected to arbitrage bot backend',
        timestamp: Date.now()
      })

      socket.on('disconnect', () => {
        console.log('❌ Frontend disconnected:', socket.id)
      })
    })
  }

  stop() {
    if (this.server) {
      this.server.close()
      console.log('🛑 WebSocket server stopped')
    }
  }
}

export default WebSocketServer
```

## Step 3: Update Your Main Index File

Modify your `src/index.js` to start the WebSocket server:

```javascript
import ArbitrageEngine from './core/arbitrageEngine.js'
import WebSocketServer from './server/websocketServer.js' // ADD THIS

async function main() {
  console.clear()
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║   CEX Funding Rate Arbitrage - With Dashboard             ║')
  console.log('║   Delta Exchange ⇄ Pi42                                    ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const engine = new ArbitrageEngine()

  // ... existing event listeners ...

  // Start the engine
  try {
    await engine.start()

    // ========================================
    // ADD THIS: Start WebSocket server for frontend
    // ========================================
    console.log('\n🚀 Starting WebSocket server for frontend dashboard...')
    const wsServer = new WebSocketServer(engine)
    wsServer.start(5000)
    console.log('✅ Dashboard available at http://localhost:3000\n')

    // ... rest of your code ...

  } catch (error) {
    console.error('❌ Fatal Error:', error)
    await engine.stop()
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('💥 Fatal Error in main():', error)
  process.exit(1)
})
```

## Step 4: Modify TradeMonitor Events

Make sure your `tradeMonitor.js` emits the events properly. Add these lines if not already present:

**In `src/monitors/tradeMonitor.js`:**

```javascript
// Line 117-120: Emit quantity mismatch event
if (qtyDiffPct > this.quantityTolerance * 100) {
  console.log('❌ QUANTITY MISMATCH → EMERGENCY EXIT')

  // ADD THIS LINE:
  this.emit('quantityMismatch', {
    deltaQty: deltaQuantity,
    pi42Qty: pi42Quantity,
    differencePct: qtyDiffPct
  })

  await this.emergencyExit('QUANTITY_MISMATCH', { ... })
}

// Line 173-187: Emit flip event
if (diff < this.minProfitThreshold * 100) {
  console.log('❌ FLIP DETECTED → EMERGENCY EXIT')

  // ADD THIS LINE:
  this.emit('flip', {
    fundingDiff: diff,
    threshold: this.minProfitThreshold * 100,
    FR_delta,
    FR_pi42
  })

  this.emergencyExit('FLIP_DETECTED', { ... })
}
```

## Step 5: Start Both Servers

### Terminal 1 - Backend:
```bash
cd C:\Users\My\Desktop\CEX-Funding-Rate-Arbitrage
npm start
```

### Terminal 2 - Frontend:
```bash
cd C:\Users\My\Desktop\funding-arbitrage-dashboard
npm run dev
```

## Step 6: Access Dashboard

Open http://localhost:3000 in your browser.

## Troubleshooting

### Issue: Frontend shows "Disconnected"

**Solution**:
1. Make sure backend is running on port 5000
2. Check console for WebSocket connection errors
3. Verify CORS settings in websocketServer.js

### Issue: No data showing up

**Solution**:
1. Check browser console for errors
2. Verify backend is emitting events (check backend console)
3. Make sure exchanges are connected (Delta + Pi42)

### Issue: Port 5000 already in use

**Solution**:
1. Change port in `websocketServer.js`: `wsServer.start(5001)`
2. Update `vite.config.js` proxy target to match

## Testing

### Test Funding Rates:
The dashboard should show live funding rates once both exchanges connect.

### Test Opportunity Detection:
When an opportunity is detected, it will appear in:
- Dashboard → Recent Opportunities
- Opportunities page → Top section

### Test Position Monitoring:
When an order is executed:
1. It appears in Orders → Open Positions
2. Live monitoring activates in Monitoring page
3. Quantity and flip checks run automatically

## Events Reference

| Event | Direction | Purpose |
|-------|-----------|---------|
| `fundingRate:delta` | Backend → Frontend | Live Delta funding rates |
| `fundingRate:pi42` | Backend → Frontend | Live Pi42 funding rates |
| `opportunity:detected` | Backend → Frontend | New opportunity found |
| `order:executed` | Backend → Frontend | Order successfully placed |
| `position:update` | Backend → Frontend | Real-time position updates |
| `alert:quantityMismatch` | Backend → Frontend | Quantity mismatch detected |
| `alert:flip` | Backend → Frontend | Funding flip detected |
| `position:closed` | Backend → Frontend | Position closed (normal/emergency) |

## Next Steps

1. Add authentication (optional)
2. Add historical data charts
3. Add P&L calculations
4. Add order history from MongoDB
5. Add settings persistence to backend
