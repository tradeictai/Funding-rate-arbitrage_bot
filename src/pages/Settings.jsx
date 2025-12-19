import { useState } from 'react'
import { Save, AlertCircle } from 'lucide-react'

const Settings = () => {
  const [settings, setSettings] = useState({
    // Trading Parameters
    leverage: 10,
    useFundPct: 0.50,
    primaryThreshold: 0.1,
    secondaryThreshold: 0.1,

    // Position Sizing
    maxPositionSizeUSD: 1000,
    minPositionSizeUSD: 0.5,

    // Monitoring
    quantityTolerance: 0.05,
    minProfitThreshold: 0.1,

    // Notifications
    enableAlerts: true,
    soundEnabled: false
  })

  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    // Save to backend
    console.log('Saving settings:', settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Settings</h2>
        <p className="text-gray-600">Configure your trading bot parameters</p>
      </div>

      {/* Settings Sections */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-6">Trading Parameters</h3>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Leverage
              </label>
              <input
                type="number"
                value={settings.leverage}
                onChange={(e) => updateSetting('leverage', parseFloat(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Use Fund Percentage
              </label>
              <input
                type="number"
                step="0.01"
                value={settings.useFundPct}
                onChange={(e) => updateSetting('useFundPct', parseFloat(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Primary Threshold (%)
              </label>
              <input
                type="number"
                step="0.01"
                value={settings.primaryThreshold}
                onChange={(e) => updateSetting('primaryThreshold', parseFloat(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Secondary Threshold (%)
              </label>
              <input
                type="number"
                step="0.01"
                value={settings.secondaryThreshold}
                onChange={(e) => updateSetting('secondaryThreshold', parseFloat(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold mb-6">Position Sizing</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Position Size (USD)
            </label>
            <input
              type="number"
              value={settings.maxPositionSizeUSD}
              onChange={(e) => updateSetting('maxPositionSizeUSD', parseFloat(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Min Position Size (USD)
            </label>
            <input
              type="number"
              step="0.1"
              value={settings.minPositionSizeUSD}
              onChange={(e) => updateSetting('minPositionSizeUSD', parseFloat(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold mb-6">Monitoring & Safety</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Quantity Tolerance (%)
            </label>
            <input
              type="number"
              step="0.01"
              value={settings.quantityTolerance}
              onChange={(e) => updateSetting('quantityTolerance', parseFloat(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="text-sm text-gray-500 mt-1">
              Maximum allowed difference between Delta and Pi42 quantities
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Min Profit Threshold (%)
            </label>
            <input
              type="number"
              step="0.01"
              value={settings.minProfitThreshold}
              onChange={(e) => updateSetting('minProfitThreshold', parseFloat(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="text-sm text-gray-500 mt-1">
              Trigger emergency exit if funding profit drops below this
            </p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 text-sm text-gray-600">
          <AlertCircle className="w-4 h-4" />
          <span>Changes will take effect immediately</span>
        </div>

        <button
          onClick={handleSave}
          className="btn btn-primary flex items-center space-x-2"
        >
          <Save className="w-4 h-4" />
          <span>{saved ? 'Saved!' : 'Save Settings'}</span>
        </button>
      </div>
    </div>
  )
}

export default Settings
