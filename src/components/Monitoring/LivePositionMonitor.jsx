import { useEffect, useState } from 'react'
import { Activity, TrendingUp, TrendingDown } from 'lucide-react'

const LivePositionMonitor = ({ position, updates }) => {
  const [deltaPosition, setDeltaPosition] = useState(null)
  const [pi42Position, setPi42Position] = useState(null)

  useEffect(() => {
    if (updates) {
      if (updates.exchange === 'delta') {
        setDeltaPosition(updates.position)
      } else if (updates.exchange === 'pi42') {
        setPi42Position(updates.position)
      }
    }
  }, [updates])

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center space-x-2">
            <Activity className="w-5 h-5 text-green-600 animate-pulse" />
            <span>Live Position Monitor: {position.token}</span>
          </h3>
          <p className="text-sm text-gray-600">Real-time position tracking via WebSocket</p>
        </div>
        <div className="flex items-center space-x-2 px-3 py-1.5 bg-green-100 text-green-800 rounded-full">
          <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse"></div>
          <span className="text-sm font-medium">Live</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Delta Position */}
        <div className="border-2 border-blue-200 rounded-lg p-5 bg-blue-50">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-gray-800 flex items-center space-x-2">
              <div className="w-4 h-4 bg-blue-600 rounded-full"></div>
              <span>Delta Exchange</span>
            </h4>
            <span className={`badge ${position.deltaSide === 'SHORT' ? 'badge-danger' : 'badge-success'}`}>
              {position.deltaSide}
            </span>
          </div>

          {deltaPosition ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-600 mb-1">Size</p>
                  <p className="text-lg font-bold text-gray-800">
                    {Math.abs(deltaPosition.size || 0).toFixed(4)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Mark Price</p>
                  <p className="text-lg font-bold text-gray-800">
                    ${deltaPosition.mark_price?.toFixed(2) || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Entry Price</p>
                  <p className="text-sm font-medium text-gray-700">
                    ${deltaPosition.entry_price?.toFixed(2) || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Unrealized PnL</p>
                  <p className={`text-sm font-bold ${
                    deltaPosition.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    ${deltaPosition.unrealized_pnl?.toFixed(2) || '0.00'}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-blue-200">
                <p className="text-xs text-gray-600 mb-1">Product Symbol</p>
                <p className="text-sm font-medium text-gray-700">{deltaPosition.product_symbol}</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500">
              Waiting for position update...
            </div>
          )}
        </div>

        {/* Pi42 Position */}
        <div className="border-2 border-purple-200 rounded-lg p-5 bg-purple-50">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-gray-800 flex items-center space-x-2">
              <div className="w-4 h-4 bg-purple-600 rounded-full"></div>
              <span>Pi42 Exchange</span>
            </h4>
            <span className={`badge ${position.pi42Side === 'SHORT' ? 'badge-danger' : 'badge-success'}`}>
              {position.pi42Side}
            </span>
          </div>

          {pi42Position ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-600 mb-1">Quantity</p>
                  <p className="text-lg font-bold text-gray-800">
                    {Math.abs(pi42Position.positionAmount || 0).toFixed(4)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Mark Price</p>
                  <p className="text-lg font-bold text-gray-800">
                    ${pi42Position.markPrice?.toFixed(2) || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Entry Price</p>
                  <p className="text-sm font-medium text-gray-700">
                    ${pi42Position.entryPrice?.toFixed(2) || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Unrealized PnL</p>
                  <p className={`text-sm font-bold ${
                    pi42Position.unrealisedPnl >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    ₹{pi42Position.unrealisedPnl?.toFixed(2) || '0.00'}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-purple-200">
                <p className="text-xs text-gray-600 mb-1">Contract Pair</p>
                <p className="text-sm font-medium text-gray-700">
                  {pi42Position.contractPair || pi42Position.symbol}
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500">
              Waiting for position update...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default LivePositionMonitor
