const OrdersTable = ({ orders }) => {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Token</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entry Time</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Exit Time</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Funding Diff</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">P&L</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Exit Type</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {orders.map((order, index) => (
            <tr key={index}>
              <td className="px-6 py-4 whitespace-nowrap font-medium">{order.token}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {new Date(order.entryTime).toLocaleString()}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {new Date(order.exitTime).toLocaleString()}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">{order.fundingDiff}%</td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={order.pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                  ${order.pnl?.toFixed(2)}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`badge ${
                  order.exitType === 'normal' ? 'badge-success' : 'badge-danger'
                }`}>
                  {order.exitType}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default OrdersTable
