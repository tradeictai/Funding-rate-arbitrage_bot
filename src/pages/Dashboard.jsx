import { useWebSocket } from '../context/WebSocketContext'
import StatsCard from '../components/Dashboard/StatsCard'
import FundingRateChart from '../components/Dashboard/FundingRateChart'
import RecentOpportunities from '../components/Dashboard/RecentOpportunities'
import ActivePositions from '../components/Dashboard/ActivePositions'
import { TrendingUp, DollarSign, Activity, AlertTriangle } from 'lucide-react'

const Dashboard = () => {
  const { opportunities, activePositions, quantityAlerts, flipAlerts } = useWebSocket()

  const stats = [
    {
      title: 'Opportunities Today',
      value: opportunities.length,
      icon: TrendingUp,
      color: 'blue',
      trend: '+12%'
    },
    {
      title: 'Active Positions',
      value: activePositions.length,
      icon: Activity,
      color: 'green',
      trend: null
    },
    {
      title: 'Total P&L',
      value: '$0.00',
      icon: DollarSign,
      color: 'purple',
      trend: '+0%'
    },
    {
      title: 'Alerts',
      value: quantityAlerts.length + flipAlerts.length,
      icon: AlertTriangle,
      color: 'red',
      trend: null
    }
  ]

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
        <p className="text-gray-600">Real-time overview of your arbitrage trading system</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <StatsCard key={index} {...stat} />
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FundingRateChart />
        <RecentOpportunities />
      </div>

      {/* Active Positions */}
      <ActivePositions />
    </div>
  )
}

export default Dashboard
