import { Bell, Wifi, WifiOff } from 'lucide-react'
import { useWebSocket } from '../../context/WebSocketContext'

const Header = () => {
  const { connected } = useWebSocket()

  return (
    <header className="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-6">
      <div className="flex items-center space-x-4">
        <h1 className="text-xl font-bold text-gray-800">
          Funding Rate Arbitrage Dashboard
        </h1>
      </div>

      <div className="flex items-center space-x-4">
        {/* Connection Status */}
        <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full ${
          connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {connected ? (
            <>
              <Wifi className="w-4 h-4" />
              <span className="text-sm font-medium">Connected</span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4" />
              <span className="text-sm font-medium">Disconnected</span>
            </>
          )}
        </div>

        {/* Notifications */}
        <button className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <Bell className="w-5 h-5 text-gray-600" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
        </button>

        {/* Time */}
        <div className="text-sm text-gray-600">
          {new Date().toLocaleTimeString()}
        </div>
      </div>
    </header>
  )
}

export default Header
