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
  agentClasses: [],
  policies: [],
  connections: [],
  auditLogs: [],
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

  fetchClasses: async () => {
    try {
      const response = await fetch('http://localhost:8000/api/agent-classes');
      if (!response.ok) throw new Error('Failed to fetch classes');
      const data = await response.json();
      set({ agentClasses: data });
    } catch (err) {
      console.error("Backend unreachable, falling back to mock classes:", err);
      const { MOCK_CLASSES } = await import('../services/mockData');
      set({ agentClasses: MOCK_CLASSES });
    }
  },

  fetchPolicies: async () => {
    try {
      const response = await fetch('http://localhost:8000/api/policies');
      if (!response.ok) throw new Error('Failed to fetch policies');
      const data = await response.json();
      set({ policies: data });
    } catch (err) {
      console.error("Backend unreachable, falling back to mock policies:", err);
      const { MOCK_POLICIES } = await import('../services/mockData');
      set({ policies: MOCK_POLICIES });
    }
  },

  fetchConnections: async () => {
    try {
      const response = await fetch('http://localhost:8000/api/connections');
      if (!response.ok) throw new Error('Failed to fetch connections');
      const data = await response.json();
      set({ connections: data });
    } catch (err) {
      console.error("Backend unreachable, falling back to mock connections:", err);
      const { MOCK_CONNECTIONS } = await import('../services/mockData');
      set({ connections: MOCK_CONNECTIONS });
    }
  },

  fetchAuditLogs: async () => {
    try {
      const response = await fetch('http://localhost:8000/api/audit-logs');
      if (!response.ok) throw new Error('Failed to fetch audit logs');
      const data = await response.json();
      set({ auditLogs: data });
    } catch (err) {
      console.error("Backend unreachable, falling back to mock audit logs:", err);
      const { MOCK_AUDIT_LOGS } = await import('../services/mockData');
      set({ auditLogs: MOCK_AUDIT_LOGS });
    }
  },
}))
