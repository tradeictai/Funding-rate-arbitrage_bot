import { AlertTriangle, TrendingDown, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const AlertsList = ({ quantityAlerts, flipAlerts }) => {
  const allAlerts = [
    ...quantityAlerts.map(a => ({ ...a, type: 'quantity' })),
    ...flipAlerts.map(a => ({ ...a, type: 'flip' }))
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2">
        <AlertTriangle className="w-5 h-5 text-red-600" />
        <span>Recent Alerts</span>
        <span className="badge badge-danger">{allAlerts.length}</span>
      </h3>

      <div className="space-y-3 max-h-[400px] overflow-y-auto">
        {allAlerts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No alerts - all systems normal
          </div>
        ) : (
          allAlerts.map((alert, index) => (
            <div
              key={index}
              className={`border rounded-lg p-4 ${
                alert.type === 'quantity'
                  ? 'border-orange-200 bg-orange-50'
                  : 'border-red-200 bg-red-50'
              }`}
            >
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  {alert.type === 'quantity' ? (
                    <AlertTriangle className="w-5 h-5 text-orange-600" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-red-600" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className={`text-sm font-semibold ${
                      alert.type === 'quantity' ? 'text-orange-800' : 'text-red-800'
                    }`}>
                      {alert.type === 'quantity' ? 'Quantity Mismatch' : 'Flip Detected'}
                    </p>
                    <span className={`badge ${
                      alert.type === 'quantity' ? 'badge-warning' : 'badge-danger'
                    }`}>
                      {alert.type.toUpperCase()}
                    </span>
                  </div>

                  <p className={`text-xs mb-2 ${
                    alert.type === 'quantity' ? 'text-orange-700' : 'text-red-700'
                  }`}>
                    {alert.reason || alert.details?.reason}
                  </p>

                  {alert.type === 'quantity' && alert.details && (
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-700">
                      <div>
                        <span className="text-gray-600">Delta: </span>
                        <span className="font-medium">{alert.details.deltaQuantity?.toFixed(4)}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Pi42: </span>
                        <span className="font-medium">{alert.details.pi42Quantity?.toFixed(4)}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Diff: </span>
                        <span className="font-medium text-orange-600">
                          {alert.details.qtyDiffPct?.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  )}

                  {alert.type === 'flip' && alert.details && (
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-700">
                      <div>
                        <span className="text-gray-600">Current Diff: </span>
                        <span className="font-medium text-red-600">
                          {alert.details.currentDiff?.toFixed(4)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Threshold: </span>
                        <span className="font-medium">{alert.details.threshold || 0.1}%</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center text-xs text-gray-600 mt-2">
                    <Clock className="w-3 h-3 mr-1" />
                    {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default AlertsList
