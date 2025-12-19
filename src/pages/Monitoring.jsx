import { useWebSocket } from '../context/WebSocketContext'
import { Activity, AlertTriangle, TrendingDown, CheckCircle } from 'lucide-react'
import LivePositionMonitor from '../components/Monitoring/LivePositionMonitor'
import QuantityCheckPanel from '../components/Monitoring/QuantityCheckPanel'
import FlipDetectionPanel from '../components/Monitoring/FlipDetectionPanel'
import AlertsList from '../components/Monitoring/AlertsList'

const Monitoring = () => {
  const {
    activePositions,
    positionUpdates,
    quantityAlerts,
    flipAlerts
  } = useWebSocket()

  const totalAlerts = quantityAlerts.length + flipAlerts.length
   console.log('Position Updates:', positionUpdates)
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Live Monitoring</h2>
          <p className="text-gray-600">Real-time position tracking and safety checks</p>
        </div>

        {activePositions.length > 0 && (
          <div className="flex items-center space-x-2 px-4 py-2 bg-green-100 text-green-800 rounded-lg">
            <Activity className="w-5 h-5 animate-pulse" />
            <span className="font-medium">Monitoring Active</span>
          </div>
        )}
      </div>

      {/* Alert Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Alerts</p>
              <p className="text-3xl font-bold text-gray-800">{totalAlerts}</p>
            </div>
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Quantity Mismatches</p>
              <p className="text-3xl font-bold text-orange-600">{quantityAlerts.length}</p>
            </div>
            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
              <Activity className="w-6 h-6 text-orange-600" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Flip Detections</p>
              <p className="text-3xl font-bold text-red-600">{flipAlerts.length}</p>
            </div>
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
              <TrendingDown className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Monitoring Content */}
      {activePositions.length === 0 ? (
        <div className="card">
          <div className="text-center py-16">
            <CheckCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-600 mb-2">No Active Positions</h3>
            <p className="text-gray-500">
              Position monitoring will start automatically when an order is executed
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Live Position Monitor */}
          {activePositions.map((position, index) => (
            <LivePositionMonitor
              key={index}
              position={position}
              updates={positionUpdates}
            />
          ))}

          {/* Quantity Check & Flip Detection Panels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <QuantityCheckPanel position={activePositions[0]} />
            <FlipDetectionPanel position={activePositions[0]} />
          </div>

          {/* Recent Alerts */}
          <AlertsList
            quantityAlerts={quantityAlerts}
            flipAlerts={flipAlerts}
          />
        </div>
      )}
    </div>
  )
}

export default Monitoring
