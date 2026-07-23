import { MOCK_AGENTS } from './mockData';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const agentService = {
  getAgents: async () => {
    await delay(500); // Simulate network latency
    return MOCK_AGENTS;
  },
  getAgentById: async (id) => {
    await delay(300);
    return MOCK_AGENTS.find(agent => agent.id === id);
  }
};
