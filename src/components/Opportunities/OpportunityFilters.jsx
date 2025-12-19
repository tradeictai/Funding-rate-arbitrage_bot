import { Filter } from 'lucide-react'

const OpportunityFilters = ({ filters, setFilters }) => {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Filter className="w-5 h-5 text-gray-600" />
          <h3 className="text-lg font-semibold">Filters</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Min Funding Rate (%)
          </label>
          <input
            type="number"
            step="0.01"
            value={filters.minFundingRate}
            onChange={(e) => setFilters({ ...filters, minFundingRate: parseFloat(e.target.value) })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Exchange
          </label>
          <select
            value={filters.exchange}
            onChange={(e) => setFilters({ ...filters, exchange: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="all">All Exchanges</option>
            <option value="delta">Delta Only</option>
            <option value="pi42">Pi42 Only</option>
          </select>
        </div>

        <div className="flex items-end">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.showOnlyAboveThreshold}
              onChange={(e) => setFilters({ ...filters, showOnlyAboveThreshold: e.target.checked })}
              className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
            />
            <span className="text-sm font-medium text-gray-700">
              Only above threshold
            </span>
          </label>
        </div>
      </div>
    </div>
  )
}

export default OpportunityFilters
