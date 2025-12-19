import { TrendingUp, TrendingDown, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const PositionCard = ({ position }) => {
  return (
    <div className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-lg font-bold text-gray-800">{position.token}</h4>
          <p className="text-sm text-gray-500">
            Opened {formatDistanceToNow(new Date(position.entryTime), { addSuffix: true })}
          </p>
        </div>
        <span className="badge badge-success">Active</span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Delta Position */}
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Delta Exchange</span>
            <div className="w-3 h-3 bg-blue-600 rounded-full"></div>
          </div>
          <div className="flex items-center space-x-2">
            {position.deltaSide === 'SHORT' ? (
              <TrendingDown className="w-5 h-5 text-red-600" />
            ) : (
              <TrendingUp className="w-5 h-5 text-green-600" />
            )}
            <span className={`text-lg font-bold ${
              position.deltaSide === 'SHORT' ? 'text-red-600' : 'text-green-600'
            }`}>
              {position.deltaSide}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Order ID: {position.deltaOrderId}</p>
        </div>

        {/* Pi42 Position */}
        <div className="bg-purple-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Pi42 Exchange</span>
            <div className="w-3 h-3 bg-purple-600 rounded-full"></div>
          </div>
          <div className="flex items-center space-x-2">
            {position.pi42Side === 'SHORT' ? (
              <TrendingDown className="w-5 h-5 text-red-600" />
            ) : (
              <TrendingUp className="w-5 h-5 text-green-600" />
            )}
            <span className={`text-lg font-bold ${
              position.pi42Side === 'SHORT' ? 'text-red-600' : 'text-green-600'
            }`}>
              {position.pi42Side}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Order ID: {position.pi42OrderId}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-200">
        <div>
          <p className="text-xs text-gray-500 mb-1">Funding Diff</p>
          <p className="text-lg font-semibold text-green-600">
            {position.fundingDiff?.toFixed(4)}%
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Next Funding</p>
          <div className="flex items-center space-x-1">
            <Clock className="w-3 h-3 text-gray-400" />
            <p className="text-sm font-medium text-gray-700">
              {new Date(position.nextFundingTime).toLocaleTimeString()}
            </p>
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">P&L</p>
          <p className="text-lg font-semibold text-gray-700">$0.00</p>
        </div>
      </div>
    </div>
  )
}

export default PositionCard
