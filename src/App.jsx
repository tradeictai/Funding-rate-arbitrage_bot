import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import Dashboard from './pages/Dashboard'
import Opportunities from './pages/Opportunities'
import Orders from './pages/Orders'
import Monitoring from './pages/Monitoring'
import Settings from './pages/Settings'
import { WebSocketProvider } from './context/WebSocketContext'

function App() {
  return (
    <WebSocketProvider>
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/opportunities" element={<Opportunities />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/monitoring" element={<Monitoring />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
      </Router>
    </WebSocketProvider>
  )
}

export default App
