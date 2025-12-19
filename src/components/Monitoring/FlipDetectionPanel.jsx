import { useEffect, useState } from 'react'
import { useWebSocket } from '../../context/WebSocketContext'
import { TrendingDown, AlertTriangle, CheckCircle } from 'lucide-react'

const FlipDetectionPanel = ({ position }) => {
  const { fundingRates } = useWebSocket()
  const [deltaFR, setDeltaFR] = useState(0)
  const [pi42FR, setPi42FR] = useState(0)
  const [currentDiff, setCurrentDiff] = useState(0)
  const [status, setStatus] = useState('safe') // 'safe', 'warning', 'flipped'

  const MIN_PROFIT_THRESHOLD = 0.1 // 0.1%

  useEffect(() => {
    // Get latest funding rates for this token
    const deltaData = fundingRates.delta.find(r => r.symbol === position.token)
    const pi42Data = fundingRates.pi42.find(r =>
      r.symbol === position.token || r.symbol === position.pi42Symbol
    )

    if (deltaData && pi42Data) {
      const deltaRate = deltaData.fundingRate || 0
      const pi42Rate = pi42Data.fundingRate || 0

      setDeltaFR(deltaRate)
      setPi42FR(pi42Rate)

      // Calculate current funding difference (same logic as backend)
      const FR_first = Math.abs(deltaRate) >= Math.abs(pi42Rate) ? deltaRate : pi42Rate
      const FR_second = Math.abs(deltaRate) >= Math.abs(pi42Rate) ? pi42Rate : deltaRate

      const sign_first = Math.sign(FR_first)
      const sign_second = Math.sign(FR_second)

      let diff
      if (sign_first === sign_second) {
        diff = Math.abs(FR_first) - Math.abs(FR_second)
      } else {
        diff = Math.abs(FR_first) + Math.abs(FR_second)
      }

      setCurrentDiff(diff)

      // Determine status
      if (diff < MIN_PROFIT_THRESHOLD) {
        setStatus('flipped')
      } else if (diff < MIN_PROFIT_THRESHOLD * 1.5) {
        setStatus('warning')
      } else {
        setStatus('safe')
      }
    }
  }, [fundingRates, position])

  const getStatusColor = () => {
    switch (status) {
      case 'safe':
        return 'green'
      case 'warning':
        return 'yellow'
      case 'flipped':
        return 'red'
      default:
        return 'gray'
    }
  }

  const statusColors = {
    green: 'bg-green-50 border-green-200',
    yellow: 'bg-yellow-50 border-yellow-200',
    red: 'bg-red-50 border-red-200',
    gray: 'bg-gray-50 border-gray-200'
  }

  return (
    <div className={`card border-2 ${statusColors[getStatusColor()]}`}>
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-800 flex items-center space-x-2">
          <TrendingDown className="w-5 h-5" />
          <span>Flip Detection</span>
        </h4>
        <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full ${
          status === 'safe' ? 'bg-green-100 text-green-800' :
          status === 'warning' ? 'bg-yellow-100 text-yellow-800' :
          status === 'flipped' ? 'bg-red-100 text-red-800' :
          'bg-gray-100 text-gray-800'
        }`}>
          {status === 'safe' ? (
            <>
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Safe</span>
            </>
          ) : status === 'warning' ? (
            <>
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-medium">Warning</span>
            </>
          ) : (
            <>
              <TrendingDown className="w-4 h-4" />
              <span className="text-sm font-medium">Flipped</span>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Current Funding Rates */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-xs text-gray-600 mb-1">Delta FR</p>
            <p className={`text-2xl font-bold ${
              deltaFR >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {deltaFR.toFixed(4)}%
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-xs text-gray-600 mb-1">Pi42 FR</p>
            <p className={`text-2xl font-bold ${
              pi42FR >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {pi42FR.toFixed(4)}%
            </p>
          </div>
        </div>

        {/* Current Difference vs Threshold */}
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Current Profit</p>
            <p className={`text-lg font-bold ${
              currentDiff >= MIN_PROFIT_THRESHOLD ? 'text-green-600' : 'text-red-600'
            }`}>
              {currentDiff.toFixed(4)}%
            </p>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all ${
                currentDiff >= MIN_PROFIT_THRESHOLD ? 'bg-green-600' :
                currentDiff >= MIN_PROFIT_THRESHOLD * 0.5 ? 'bg-yellow-600' :
                'bg-red-600'
              }`}
              style={{ width: `${Math.min((currentDiff / (MIN_PROFIT_THRESHOLD * 2)) * 100, 100)}%` }}
            ></div>
          </div>

          <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
            <span>0%</span>
            <span className="font-medium">Threshold: {MIN_PROFIT_THRESHOLD}%</span>
            <span>{(MIN_PROFIT_THRESHOLD * 2).toFixed(2)}%</span>
          </div>
        </div>

        {/* Comparison */}
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Entry Funding Diff:</span>
            <span className="font-bold text-gray-800">{position.fundingDiff?.toFixed(4)}%</span>
          </div>
          <div className="flex items-center justify-between text-sm mt-2">
            <span className="text-gray-600">Current Funding Diff:</span>
            <span className={`font-bold ${
              currentDiff >= position.fundingDiff ? 'text-green-600' : 'text-red-600'
            }`}>
              {currentDiff.toFixed(4)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-sm mt-2 pt-2 border-t border-gray-200">
            <span className="text-gray-600">Change:</span>
            <span className={`font-bold ${
              currentDiff >= position.fundingDiff ? 'text-green-600' : 'text-red-600'
            }`}>
              {(currentDiff - position.fundingDiff).toFixed(4)}%
            </span>
          </div>
        </div>

        {/* Alert Messages */}
        {status === 'flipped' && (
          <div className="bg-red-100 border border-red-300 rounded-lg p-3 flex items-start space-x-2">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">Flip Detected!</p>
              <p className="text-xs text-red-700 mt-1">
                Funding profit dropped to {currentDiff.toFixed(4)}% (below {MIN_PROFIT_THRESHOLD}% threshold).
                Emergency exit triggered!
              </p>
            </div>
          </div>
        )}

        {status === 'warning' && (
          <div className="bg-yellow-100 border border-yellow-300 rounded-lg p-3 flex items-start space-x-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-yellow-800">Warning!</p>
              <p className="text-xs text-yellow-700 mt-1">
                Funding profit dropping. Currently at {currentDiff.toFixed(4)}%.
                Close to flip threshold.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default FlipDetectionPanel
