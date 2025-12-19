import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  TrendingUp,
  ShoppingCart,
  Activity,
  Settings,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import useStore from '../../store/useStore'

const Sidebar = () => {
  const { sidebarOpen, toggleSidebar } = useStore()

  const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/opportunities', icon: TrendingUp, label: 'Opportunities' },
    { path: '/orders', icon: ShoppingCart, label: 'Orders' },
    { path: '/monitoring', icon: Activity, label: 'Live Monitor' },
    { path: '/settings', icon: Settings, label: 'Settings' }
  ]

  return (
    <aside className={`fixed left-0 top-0 h-screen bg-gray-900 text-white transition-all duration-300 z-50 ${
      sidebarOpen ? 'w-64' : 'w-20'
    }`}>
      {/* Logo */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        {sidebarOpen && (
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg">Arbitrage Bot</span>
          </div>
        )}

        <button
          onClick={toggleSidebar}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
        >
          {sidebarOpen ? (
            <ChevronLeft className="w-5 h-5" />
          ) : (
            <ChevronRight className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="mt-6 px-3">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center space-x-3 px-3 py-3 rounded-lg mb-2 transition-colors ${
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            {sidebarOpen && <span className="font-medium">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Status Indicator */}
      {sidebarOpen && (
        <div className="absolute bottom-6 left-4 right-4">
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">System Status</span>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs text-green-500">Online</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

export default Sidebar
