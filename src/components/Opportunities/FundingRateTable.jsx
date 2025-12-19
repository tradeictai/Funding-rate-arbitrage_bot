import { TrendingUp, TrendingDown } from 'lucide-react'

const FundingRateTable = ({ data, exchange }) => {
  console.log('Rendering FundingRateTable for', exchange, data)
  return (
    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Funding Rate</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mark Price</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Next Funding</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.length === 0 ? (
            <tr>
              <td colSpan="4" className="px-4 py-8 text-center text-gray-500">
                No data available
              </td>
            </tr>
          ) : (
            data.map((item, index) => {
              const fundingRate = item.fundingRate || 0
              const isPositive = fundingRate > 0

              return (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900">
                    {item.symbol?.replace('USD', '')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      {isPositive ? (
                        <TrendingUp className="w-4 h-4 text-green-600" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-600" />
                      )}
                      <span className={`font-semibold ${
                        isPositive ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {fundingRate.toFixed(4)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                    {/* FIXED LINE */}
                    {item.markPrice 
                      ? `$${parseFloat(item.markPrice).toFixed(2)}` 
                      : 'N/A'
                    }
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {item.nextFundingTime
                      ? new Date(item.nextFundingTime).toLocaleTimeString()
                      : 'N/A'
                    }
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export default FundingRateTable