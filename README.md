# Funding Rate Arbitrage Dashboard

Real-time monitoring dashboard for CEX Funding Rate Arbitrage trading bot built with React and Tailwind CSS.

## Features

### 1. **Live Funding Rate Monitoring**
- Real-time funding rate updates from Delta Exchange and Pi42
- Continuous opportunity detection
- Top 15 tokens from each exchange
- Live filtering and sorting

### 2. **Orders & Positions**
- **Open Positions**: Active trades with real-time updates
- **Closed Positions**: Historical trade data
- Detailed position information for both exchanges
- P&L tracking

### 3. **Live Monitoring**
- **Quantity Check**: Real-time verification of position sizes across exchanges
- **Flip Detection**: Monitors funding rate changes and triggers alerts
- Live position updates via WebSocket
- Visual alerts for mismatches and flips

### 4. **Dashboard**
- Overview of all trading activities
- Statistics cards showing key metrics
- Recent opportunities chart
- Active positions summary

### 5. **Settings**
- Configure trading parameters
- Adjust thresholds and tolerances
- Real-time settings updates

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **React Router** - Navigation
- **Socket.IO Client** - Real-time WebSocket communication
- **Recharts** - Data visualization
- **Lucide React** - Icons
- **Zustand** - State management
- **date-fns** - Date formatting

## Project Structure

```
funding-arbitrage-dashboard/
├── public/
├── src/
│   ├── components/
│   │   ├── Dashboard/
│   │   │   ├── StatsCard.jsx
│   │   │   ├── FundingRateChart.jsx
│   │   │   ├── RecentOpportunities.jsx
│   │   │   └── ActivePositions.jsx
│   │   ├── Opportunities/
│   │   │   ├── FundingRateTable.jsx
│   │   │   └── OpportunityFilters.jsx
│   │   ├── Orders/
│   │   │   ├── PositionCard.jsx
│   │   │   └── OrdersTable.jsx
│   │   ├── Monitoring/
│   │   │   ├── LivePositionMonitor.jsx
│   │   │   ├── QuantityCheckPanel.jsx
│   │   │   ├── FlipDetectionPanel.jsx
│   │   │   └── AlertsList.jsx
│   │   └── Layout/
│   │       ├── Layout.jsx
│   │       ├── Sidebar.jsx
│   │       └── Header.jsx
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── Opportunities.jsx
│   │   ├── Orders.jsx
│   │   ├── Monitoring.jsx
│   │   └── Settings.jsx
│   ├── context/
│   │   └── WebSocketContext.jsx
│   ├── store/
│   │   └── useStore.js
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm run dev
   ```

3. **Access the dashboard:**
   Open http://localhost:3000 in your browser

## Backend Integration

### WebSocket Events

The dashboard listens to the following WebSocket events from your backend:

#### Funding Rate Updates
```javascript
socket.emit('fundingRate:delta', {
  symbol: 'BTCUSD',
  fundingRate: 0.0125,
  markPrice: 50000,
  nextFundingTime: 1640000000000
})

socket.emit('fundingRate:pi42', {
  symbol: 'BTCUSDT',
  fundingRate: -0.0075,
  markPrice: 50000,
  nextFundingTime: 1640000000000
})
```

#### Opportunity Detection
```javascript
socket.emit('opportunity:detected', {
  token: 'BTCUSD',
  FR_delta: 0.0125,
  FR_pi42: -0.0075,
  fundingDiff: 0.02,
  timestamp: Date.now()
})
```

#### Order Execution
```javascript
socket.emit('order:executed', {
  token: 'BTCUSD',
  deltaSymbol: 'BTCUSD',
  pi42Symbol: 'BTCUSDT',
  deltaSide: 'SHORT',
  pi42Side: 'LONG',
  deltaOrderId: '123456',
  pi42OrderId: '789012',
  entryTime: Date.now(),
  fundingDiff: 0.02,
  nextFundingTime: 1640000000000
})
```

#### Position Updates
```javascript
// Delta position update
socket.emit('position:update', {
  exchange: 'delta',
  token: 'BTCUSD',
  position: {
    product_symbol: 'BTCUSD',
    size: -0.5,
    entry_price: 50000,
    mark_price: 50100,
    unrealized_pnl: 50,
    product: {
      contract_value: 1
    }
  }
})

// Pi42 position update
socket.emit('position:update', {
  exchange: 'pi42',
  token: 'BTCUSDT',
  position: {
    symbol: 'BTCUSDT',
    contractPair: 'BTCUSDT',
    positionAmount: 0.5,
    entryPrice: 50000,
    markPrice: 50100,
    unrealisedPnl: 50,
    positionType: 'LONG'
  }
})
```

#### Alerts
```javascript
// Quantity mismatch alert
socket.emit('alert:quantityMismatch', {
  timestamp: Date.now(),
  reason: 'Quantity mismatch detected',
  details: {
    deltaQuantity: 0.5,
    pi42Quantity: 0.48,
    qtyDiffPct: 4.0
  }
})

// Flip detection alert
socket.emit('alert:flip', {
  timestamp: Date.now(),
  reason: 'Funding rate flip detected',
  details: {
    currentDiff: 0.05,
    threshold: 0.1
  }
})
```

#### Position Closed
```javascript
socket.emit('position:closed', {
  token: 'BTCUSD',
  exitType: 'normal', // or 'emergency'
  pnl: 125.50,
  exitTime: Date.now()
})
```

## Connecting to Your Backend

You need to add a WebSocket server to your existing backend. Create this file in your main project:

**File: `CEX-Funding-Rate-Arbitrage/src/server/websocketServer.js`**

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
    // Listen to arbitrageEngine events and emit to frontend

    // Funding rate updates
    this.engine.deltaExchange.on('update', (data) => {
      this.io.emit('fundingRate:delta', data)
    })

    this.engine.pi42Exchange.on('update', (data) => {
      this.io.emit('fundingRate:pi42', data)
    })

    // Opportunity detection
    this.engine.on('opportunity', (opportunity) => {
      this.io.emit('opportunity:detected', opportunity)
    })

    // Order execution
    this.engine.on('orderExecuted', (order) => {
      this.io.emit('order:executed', order)
    })

    // Position updates (from tradeMonitor)
    if (this.engine.tradeMonitor) {
      this.engine.tradeMonitor.deltaMonitor.on('position', (data) => {
        this.io.emit('position:update', {
          exchange: 'delta',
          token: data.position.product_symbol,
          position: data.position
        })
      })

      this.engine.tradeMonitor.pi42Monitor.on('position', (data) => {
        this.io.emit('position:update', {
          exchange: 'pi42',
          token: data.position.symbol || data.position.contractPair,
          position: data.position
        })
      })

      // Alerts
      this.engine.tradeMonitor.on('quantityMismatch', (alert) => {
        this.io.emit('alert:quantityMismatch', alert)
      })

      this.engine.tradeMonitor.on('flip', (alert) => {
        this.io.emit('alert:flip', alert)
      })

      // Position closed
      this.engine.on('positionClosed', (result) => {
        this.io.emit('position:closed', result)
      })
    }

    // Connection handling
    this.io.on('connection', (socket) => {
      console.log('✅ Frontend connected:', socket.id)

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

**Add to your `src/index.js`:**

```javascript
import WebSocketServer from './server/websocketServer.js'

// After creating arbitrageEngine
const engine = new ArbitrageEngine()
await engine.start()

// Start WebSocket server for frontend
const wsServer = new WebSocketServer(engine)
wsServer.start(5000)
```

## Development

- **Port**: Frontend runs on http://localhost:3000
- **Backend WebSocket**: Expected on http://localhost:5000
- **Hot Reload**: Enabled via Vite

## Build for Production

```bash
npm run build
```

Output will be in the `dist/` folder.

## Preview Production Build

```bash
npm run preview
```

## License

ISC
