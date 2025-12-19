import { createContext, useContext, useEffect, useState } from 'react'
import { io } from 'socket.io-client'

const WebSocketContext = createContext(null)

export const useWebSocket = () => {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocket must be used within WebSocketProvider')
  }
  return context
}

export const WebSocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)
  const [fundingRates, setFundingRates] = useState({ delta: [], pi42: [] })
  const [opportunities, setOpportunities] = useState([])
  const [activePositions, setActivePositions] = useState([])
  const [positionUpdates, setPositionUpdates] = useState(null)
  const [quantityAlerts, setQuantityAlerts] = useState([])
  const [flipAlerts, setFlipAlerts] = useState([])

  useEffect(() => {
    // Connect to backend WebSocket
    const newSocket = io('http://localhost:5000', {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    })

    newSocket.on('connect', () => {
      console.log('✅ WebSocket connected')
      setConnected(true)
    })

    newSocket.on('disconnect', () => {
      console.log('❌ WebSocket disconnected')
      setConnected(false)
    })

    // Listen to funding rate updates from backend
    newSocket.on('fundingRate:delta', (data) => {
      setFundingRates(prev => ({
        ...prev,
        delta: updateFundingRateList(prev.delta, data)
      }))
    })

    newSocket.on('fundingRate:pi42', (data) => {
      setFundingRates(prev => ({
        ...prev,
        pi42: updateFundingRateList(prev.pi42, data)
      }))
    })

    // Listen to opportunity events
    newSocket.on('opportunity:detected', (opportunity) => {
      setOpportunities(prev => [opportunity, ...prev].slice(0, 50))
    })

    // Listen to order execution events
    newSocket.on('order:executed', (order) => {
      setActivePositions(prev => [order, ...prev])
    })

    // Listen to position updates (from tradeMonitor.js)
    newSocket.on('position:update', (update) => {
      console.log('Position Update Received:', update)
      setPositionUpdates(update)

      // Update or add position to active positions
      setActivePositions(prev => {
        const existingIndex = prev.findIndex(pos => pos.token === update.token)

        if (existingIndex >= 0) {
          // Update existing position
          const updated = [...prev]
          updated[existingIndex] = { ...updated[existingIndex], ...update }
          return updated
        } else {
          // Add new position (from snapshot or new trade)
          return [...prev, {
            token: update.token,
            deltaSymbol: update.token,
            pi42Symbol: update.token,
            deltaSide: update.position?.size > 0 ? 'LONG' : 'SHORT',
            pi42Side: 'UNKNOWN', // Will be updated when Pi42 position arrives
            entryTime: Date.now(),
            exchange: update.exchange,
            position: update.position
          }]
        }
      })
    })

    // Listen to quantity mismatch alerts
    newSocket.on('alert:quantityMismatch', (alert) => {
      setQuantityAlerts(prev => [alert, ...prev].slice(0, 20))
    })

    // Listen to flip detection alerts
    newSocket.on('alert:flip', (alert) => {
      setFlipAlerts(prev => [alert, ...prev].slice(0, 20))
    })

    // Listen to position closed events
    newSocket.on('position:closed', (result) => {
      setActivePositions(prev =>
        prev.filter(pos => pos.token !== result.token)
      )
    })

    setSocket(newSocket)

    return () => {
      newSocket.close()
    }
  }, [])

  const updateFundingRateList = (list, newData) => {
    const index = list.findIndex(item => item.symbol === newData.symbol)
    if (index >= 0) {
      const newList = [...list]
      newList[index] = { ...newList[index], ...newData }
      return newList
    }
    return [...list, newData].slice(0, 50) // Keep only top 50
  }

  const value = {
    socket,
    connected,
    fundingRates,
    opportunities,
    activePositions,
    positionUpdates,
    quantityAlerts,
    flipAlerts
  }

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  )
}
