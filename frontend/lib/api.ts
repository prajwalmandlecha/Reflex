// Typed API client layer. All components import from here, never directly
// from mock data. When a real backend is ready, replace the function bodies
// with fetch calls — the signatures and return types stay the same.

import type {
  AgentClass,
  AgentInstance,
  BankConnection,
  Policy,
  ActivityEvent,
  AuditLogEntry,
  StopEvent,
  AlertItem,
  FleetStatus,
} from './types';
import {
  agentClasses,
  agentInstances,
  bankConnections,
  policies,
  auditLog,
  stopEvents,
  alerts,
  operatorName,
} from './mock-data';

export const api = {
  getAgentClasses(): Promise<AgentClass[]> {
    return Promise.resolve(agentClasses);
  },

  getAgentInstances(): Promise<AgentInstance[]> {
    return Promise.resolve(agentInstances);
  },

  getBankConnections(): Promise<BankConnection[]> {
    return Promise.resolve(bankConnections);
  },

  getPolicies(): Promise<Policy[]> {
    return Promise.resolve(policies);
  },

  getAuditLog(): Promise<AuditLogEntry[]> {
    return Promise.resolve(auditLog);
  },

  getStopEvents(): Promise<StopEvent[]> {
    return Promise.resolve(stopEvents);
  },

  getAlerts(): Promise<AlertItem[]> {
    return Promise.resolve(alerts);
  },

  getOperator(): Promise<string> {
    return Promise.resolve(operatorName);
  },

  computeFleetStatus(instances: AgentInstance[]): FleetStatus {
    const hasKilled = instances.some((i) => i.status === 'killed');
    const hasRevoked = instances.some((i) => i.status === 'revoked');
    if (hasKilled) return 'stopped';
    if (hasRevoked) return 'degraded';
    return 'healthy';
  },

  computeFleetSpend(instances: AgentInstance[]): { spent: number; cap: number } {
    return instances.reduce(
      (acc, i) => ({
        spent: acc.spent + i.spendToday,
        cap: acc.cap + i.capToday,
      }),
      { spent: 0, cap: 0 }
    );
  },

  countDenialsLastHour(events: ActivityEvent[]): number {
    const oneHourAgo = Date.now() - 3600000;
    return events.filter(
      (e) => e.decision === 'deny' && new Date(e.timestamp).getTime() > oneHourAgo
    ).length;
  },
};
