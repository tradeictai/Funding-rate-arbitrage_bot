import { useWebSocket } from '../../context/WebSocketContext'
import { Activity } from 'lucide-react'

const ActivePositions = () => {
  const { activePositions } = useWebSocket()

  console.log('Active Positions:', activePositions)

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2">
        <Activity className="w-5 h-5" />
        <span>Active Positions</span>
        <span className="badge badge-info">{activePositions.length}</span>
      </h3>

      {activePositions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No active positions
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Token</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Delta</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pi42</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Funding Diff</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entry Time</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {activePositions.map((position, index) => (
                <tr key={index}>
                  <td className="px-6 py-4 whitespace-nowrap font-medium">{position.token}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={position.deltaSide === 'SHORT' ? 'text-red-600' : 'text-green-600'}>
                      {position.deltaSide}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={position.pi42Side === 'SHORT' ? 'text-red-600' : 'text-green-600'}>
                      {position.pi42Side}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {position.fundingDiff?.toFixed(4)}%
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(position.entryTime).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="badge badge-success">Active</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ActivePositions
