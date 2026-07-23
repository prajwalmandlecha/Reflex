// Data contracts for the Agent Governance Control Center.
// These mirror the spec in §6 and are the single source of truth
// for both the mock API client and all UI components.

export type AgentClass = {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  defaultConstraints: Record<string, unknown>;
  defaultCap: { amount: number; window: 'day' | 'month' };
  instanceCount: number;
};

export type AgentStatus = 'active' | 'revoked' | 'killed';

export type AgentInstance = {
  id: string;
  classId: string;
  status: AgentStatus;
  spendToday: number;
  capToday: number;
  lastAction: string;
  lastSeen: string; // ISO timestamp
  instanceOverrides?: {
    tools?: string[];
    capOverride?: { amount: number; window: 'day' | 'month' };
  };
};

export type BankConnection = {
  id: string;
  name: string;
  sourceType: 'native_mcp' | 'openapi' | 'manual';
  toolCount: number;
  status: 'connected' | 'error' | 'pending';
  tools: BankTool[];
  authType?: 'api_key' | 'bearer' | 'basic' | 'oauth2';
  lastSync?: string;
};

export type BankTool = {
  id: string;
  name: string;
  method: string;
  path: string;
  description: string;
  exposed: boolean;
  convertible: boolean;
};

export type Policy = {
  id: string;
  name: string;
  scope: 'class' | 'instance';
  targetId: string;
  targetName: string;
  type: 'visual' | 'rego';
  status: 'draft' | 'active';
  lastModified: string;
  regoSource?: string;
  visualRule?: VisualRule;
};

export type VisualRule = {
  action: string;
  conditions: RuleCondition[];
};

export type RuleCondition = {
  field: string;
  operator: 'eq' | 'lt' | 'gt' | 'lte' | 'gte' | 'in' | 'contains';
  value: string | number;
};

export type ActivityEvent = {
  id: string;
  timestamp: string;
  agentId: string;
  agentClass: string;
  action: string;
  params: Record<string, unknown>;
  decision: 'allow' | 'deny';
  reason?: string;
  latencyMs: number;
  bankConnectionId?: string;
};

export type AuditLogEntry = ActivityEvent & {
  entryType: 'action' | 'config_change' | 'policy_change' | 'stop_event';
  oldValue?: string;
  newValue?: string;
  operator?: string;
};

export type FleetStatus = 'healthy' | 'degraded' | 'stopped';

export type StopEvent = {
  id: string;
  timestamp: string;
  scope: 'fleet' | 'class' | 'instance';
  targetId?: string;
  targetName?: string;
  action: 'stop' | 'resume';
  operator: string;
  reason: string;
};

export type AlertItem = {
  id: string;
  timestamp: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'revocation' | 'cap_breach' | 'emergency_stop' | 'policy_change';
  title: string;
  detail: string;
  source: string;
};
