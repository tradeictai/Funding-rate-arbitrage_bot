import { useState } from 'react'
import Sidebar from './Sidebar'
import Header from './Header'
import useStore from '../../store/useStore'

const Layout = ({ children }) => {
  const sidebarOpen = useStore((state) => state.sidebarOpen)

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />

      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${
        sidebarOpen ? 'ml-64' : 'ml-20'
      }`}>
        <Header />

        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}

export default Layout
