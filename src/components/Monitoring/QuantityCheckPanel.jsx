import { useEffect, useState } from 'react'
import { useWebSocket } from '../../context/WebSocketContext'
import { AlertTriangle, CheckCircle, Activity } from 'lucide-react'

const QuantityCheckPanel = ({ position }) => {
  const { positionUpdates } = useWebSocket()
  const [deltaQty, setDeltaQty] = useState(0)
  const [pi42Qty, setPi42Qty] = useState(0)
  const [difference, setDifference] = useState(0)
  const [differencePct, setDifferencePct] = useState(0)
  const [status, setStatus] = useState('checking') // 'checking', 'matched', 'mismatch'

  const TOLERANCE = 5 // 5% tolerance


  console.log('QuantityCheckPanel Position Updates:', positionUpdates)

  useEffect(() => {
    if (positionUpdates) {
      if (positionUpdates.exchange === 'delta' && positionUpdates.position) {
        const size = Math.abs(positionUpdates.position.size || 0)
        const contractValue = parseFloat(positionUpdates.position.product?.contract_value || 1)
        setDeltaQty(size * contractValue)
      } else if (positionUpdates.exchange === 'pi42' && positionUpdates.position) {
        setPi42Qty(Math.abs(positionUpdates.position.positionAmount || 0))
      }
    }
  }, [positionUpdates])

  useEffect(() => {
    if (deltaQty > 0 && pi42Qty > 0) {
      const maxQty = Math.max(deltaQty, pi42Qty)
      const diff = Math.abs(deltaQty - pi42Qty)
      const diffPct = (diff / maxQty) * 100

      setDifference(diff)
      setDifferencePct(diffPct)

      if (diffPct > TOLERANCE) {
        setStatus('mismatch')
      } else {
        setStatus('matched')
      }
    }
  }, [deltaQty, pi42Qty])

  const getStatusColor = () => {
    switch (status) {
      case 'matched':
        return 'green'
      case 'mismatch':
        return 'red'
      default:
        return 'gray'
    }
  }

  const statusColors = {
    green: 'bg-green-50 border-green-200',
    red: 'bg-red-50 border-red-200',
    gray: 'bg-gray-50 border-gray-200'
  }

  return (
    <div className={`card border-2 ${statusColors[getStatusColor()]}`}>
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-800 flex items-center space-x-2">
          <Activity className="w-5 h-5" />
          <span>Quantity Check</span>
        </h4>
        <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full ${
          status === 'matched' ? 'bg-green-100 text-green-800' :
          status === 'mismatch' ? 'bg-red-100 text-red-800' :
          'bg-gray-100 text-gray-800'
        }`}>
          {status === 'matched' ? (
            <>
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Match</span>
            </>
          ) : status === 'mismatch' ? (
            <>
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-medium">Mismatch</span>
            </>
          ) : (
            <span className="text-sm font-medium">Checking...</span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Quantities */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-xs text-gray-600 mb-1">Delta Quantity</p>
            <p className="text-2xl font-bold text-blue-600">{deltaQty.toFixed(4)}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-xs text-gray-600 mb-1">Pi42 Quantity</p>
            <p className="text-2xl font-bold text-purple-600">{pi42Qty.toFixed(4)}</p>
          </div>
        </div>

        {/* Difference */}
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Difference</p>
            <p className={`text-lg font-bold ${
              differencePct > TOLERANCE ? 'text-red-600' : 'text-green-600'
            }`}>
              {differencePct.toFixed(2)}%
            </p>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all ${
                differencePct > TOLERANCE ? 'bg-red-600' : 'bg-green-600'
              }`}
              style={{ width: `${Math.min(differencePct, 100)}%` }}
            ></div>
          </div>

          <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
            <span>0%</span>
            <span className="font-medium">Tolerance: {TOLERANCE}%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Alert Message */}
        {status === 'mismatch' && (
          <div className="bg-red-100 border border-red-300 rounded-lg p-3 flex items-start space-x-2">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">Quantity Mismatch Detected!</p>
              <p className="text-xs text-red-700 mt-1">
                Position quantities differ by {differencePct.toFixed(2)}% (above {TOLERANCE}% tolerance).
                Emergency exit may be triggered.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default QuantityCheckPanel
