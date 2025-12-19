import { useWebSocket } from '../../context/WebSocketContext'
import {  Clock, TrendingUp } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const RecentOpportunities = () => {
  const { opportunities } = useWebSocket()

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2">
        <TrendingUp className="w-5 h-5" />
        <span>Recent Opportunities</span>
      </h3>

      <div className="space-y-3 max-h-[300px] overflow-y-auto">
        {opportunities.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No opportunities detected yet
          </div>
        ) : (
          opportunities.slice(0, 10).map((opp, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-gray-800">{opp.token}</span>
                <span className={`badge ${
                  opp.fundingDiff >= 0.2 ? 'badge-success' :
                  opp.fundingDiff >= 0.1 ? 'badge-warning' :
                  'badge-info'
                }`}>
                  {opp.fundingDiff?.toFixed(4)}%
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm text-gray-600 mb-2">
                <div>Delta: {opp.FR_delta?.toFixed(4)}%</div>
                <div>Pi42: {opp.FR_pi42?.toFixed(4)}%</div>
              </div>

              <div className="flex items-center text-xs text-gray-500">
                <Clock className="w-3 h-3 mr-1" />
                {formatDistanceToNow(new Date(opp.timestamp), { addSuffix: true })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default RecentOpportunities
