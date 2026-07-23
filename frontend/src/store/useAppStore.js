import { create } from 'zustand'

export const useAppStore = create((set) => ({
  isSidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  
  theme: 'dark',
  setTheme: (theme) => set({ theme }),

  notifications: [],
  addNotification: (notification) => set((state) => ({ 
    notifications: [...state.notifications, notification] 
  })),
  clearNotifications: () => set({ notifications: [] }),

  agents: [],
  isLoading: false,
  error: null,

  fetchAgents: async () => {
    set({ isLoading: true });
    try {
      const response = await fetch('http://localhost:8000/api/agents');
      if (!response.ok) throw new Error('Failed to fetch agents');
      
      const data = await response.json();
      set({ agents: data, error: null });
    } catch (err) {
      console.error("Backend unreachable, falling back to mock data:", err);
      const { MOCK_AGENTS } = await import('../services/mockData');
      set({ agents: MOCK_AGENTS, error: err.message });
    } finally {
      set({ isLoading: false });
    }
  },
}))
