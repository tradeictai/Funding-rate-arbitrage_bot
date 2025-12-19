import { create } from 'zustand'

const useStore = create((set) => ({
  // UI State
  sidebarOpen: true,
  theme: 'light',

  // Filter states
  filters: {
    minFundingRate: 0.1,
    showOnlyAboveThreshold: true,
    selectedExchange: 'all'
  },

  // Actions
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setTheme: (theme) => set({ theme }),
  updateFilters: (filters) => set((state) => ({
    filters: { ...state.filters, ...filters }
  })),
}))

export default useStore
