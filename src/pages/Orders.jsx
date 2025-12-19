import { useState } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import { ShoppingCart, History, TrendingUp, TrendingDown } from 'lucide-react'
import OrdersTable from '../components/Orders/OrdersTable'
import PositionCard from '../components/Orders/PositionCard'

const Orders = () => {
  const { activePositions } = useWebSocket()
  const [activeTab, setActiveTab] = useState('open') // 'open' | 'closed'

  // Mock closed positions (in production, fetch from backend)
  const closedPositions = []

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Orders & Positions</h2>
        <p className="text-gray-600">Track your open and closed positions</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Open Positions</p>
              <p className="text-3xl font-bold text-gray-800">{activePositions.length}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <ShoppingCart className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Closed Positions</p>
              <p className="text-3xl font-bold text-gray-800">{closedPositions.length}</p>
            </div>
            <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
              <History className="w-6 h-6 text-gray-600" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total P&L</p>
              <p className="text-3xl font-bold text-green-600">$0.00</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="card">
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('open')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'open'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Open Positions ({activePositions.length})
            </button>
            <button
              onClick={() => setActiveTab('closed')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'closed'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Closed Positions ({closedPositions.length})
            </button>
          </nav>
        </div>

        {/* Content */}
        {activeTab === 'open' ? (
          <div className="space-y-4">
            {activePositions.length === 0 ? (
              <div className="text-center py-12">
                <ShoppingCart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">No Open Positions</h3>
                <p className="text-gray-500">Active positions will appear here when orders are executed</p>
              </div>
            ) : (
              activePositions.map((position, index) => (
                <PositionCard key={index} position={position} />
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {closedPositions.length === 0 ? (
              <div className="text-center py-12">
                <History className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">No Closed Positions</h3>
                <p className="text-gray-500">Closed positions history will appear here</p>
              </div>
            ) : (
              <OrdersTable orders={closedPositions} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default Orders
