import { useState, useMemo } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import FundingRateTable from '../components/Opportunities/FundingRateTable'
import OpportunityFilters from '../components/Opportunities/OpportunityFilters'
import { RefreshCw, TrendingUp } from 'lucide-react'

const Opportunities = () => {
  const { fundingRates, opportunities } = useWebSocket()
  const [filters, setFilters] = useState({
    minFundingRate: 0.1,
    exchange: 'all',
    showOnlyAboveThreshold: false
  })

  // Filter funding rates based on criteria
  const filteredDeltaRates = useMemo(() => {
    let rates = fundingRates.delta || []

    if (filters.showOnlyAboveThreshold) {
      rates = rates.filter(r => Math.abs(r.fundingRate || 0) >= filters.minFundingRate)
    }

    return rates.sort((a, b) =>
      Math.abs(b.fundingRate || 0) - Math.abs(a.fundingRate || 0)
    )
  }, [fundingRates.delta, filters])

  const filteredPi42Rates = useMemo(() => {
    let rates = fundingRates.pi42 || []

    if (filters.showOnlyAboveThreshold) {
      rates = rates.filter(r => Math.abs(r.fundingRate || 0) >= filters.minFundingRate)
    }

    return rates.sort((a, b) =>
      Math.abs(b.fundingRate || 0) - Math.abs(a.fundingRate || 0)
    )
  }, [fundingRates.pi42, filters])

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Live Funding Rates</h2>
          <p className="text-gray-600">Real-time monitoring of funding rate opportunities</p>
        </div>

        <button className="btn btn-primary flex items-center space-x-2">
          <RefreshCw className="w-4 h-4" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filters */}
      <OpportunityFilters filters={filters} setFilters={setFilters} />

      {/* Detected Opportunities */}
      {opportunities.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            <span>Detected Opportunities</span>
            <span className="badge badge-success">{opportunities.length}</span>
          </h3>

          <div className="space-y-3">
            {opportunities.slice(0, 5).map((opp, index) => (
              <div
                key={index}
                className="border border-green-200 bg-green-50 rounded-lg p-4 animate-slideIn"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-gray-800">{opp.token}</div>
                    <div className="text-sm text-gray-600">
                      Delta: {opp.FR_delta?.toFixed(4)}% | Pi42: {opp.FR_pi42?.toFixed(4)}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-green-600">
                      {opp.fundingDiff?.toFixed(4)}%
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(opp.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Funding Rate Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Delta Exchange */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2">
            <div className="w-6 h-6 bg-blue-600 rounded-full"></div>
            <span>Delta Exchange</span>
            <span className="badge badge-info">{filteredDeltaRates.length}</span>
          </h3>
          <FundingRateTable data={filteredDeltaRates} exchange="delta" />
        </div>

        {/* Pi42 Exchange */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2">
            <div className="w-6 h-6 bg-purple-600 rounded-full"></div>
            <span>Pi42 Exchange</span>
            <span className="badge badge-info">{filteredPi42Rates.length}</span>
          </h3>
          <FundingRateTable data={filteredPi42Rates} exchange="pi42" />
        </div>
      </div>
    </div>
  )
}

export default Opportunities
