import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useWebSocket } from '../../context/WebSocketContext'

const FundingRateChart = () => {
  const { fundingRates } = useWebSocket()

  // Prepare data for chart (top 10 tokens)
  const chartData = fundingRates.delta.slice(0, 10).map((item, index) => ({
    name: item.symbol?.replace('USD', '') || `Token ${index}`,
    delta: item.fundingRate || 0,
    pi42: fundingRates.pi42.find(p => p.symbol === item.symbol)?.fundingRate || 0
  }))

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4">Funding Rates Comparison</h3>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="delta"
            stroke="#0284c7"
            strokeWidth={2}
            name="Delta"
          />
          <Line
            type="monotone"
            dataKey="pi42"
            stroke="#9333ea"
            strokeWidth={2}
            name="Pi42"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default FundingRateChart
