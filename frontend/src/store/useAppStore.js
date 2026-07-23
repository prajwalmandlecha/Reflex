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
}))
