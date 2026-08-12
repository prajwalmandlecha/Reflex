// Data contracts for the Agent Governance Control Center.

export type AgentClass = {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  defaultConstraints: Record<string, unknown>;
  defaultAllowedTools?: string[];
  defaultConstraintsDict?: Record<string, unknown>;
  instanceCount: number;
  status?: string;
  created_at?: string;
  updated_at?: string;
  // Derived health: which of this class's default tools are currently unreachable.
  unreachableTools?: string[];
  unreachable_tools?: string[];
};

export type AgentStatus = "active" | "revoked" | "killed";

export type AgentInstance = {
  id: string;
  classId: string;
  class_id?: string;
  status: AgentStatus;
  lastAction: string;
  lastSeen: string;
  className?: string;
  class_name?: string;
  instanceOverrides?: {
    tools?: string[];
    capOverride?: { amount: number; window: "day" | "month" };
  };
  constraint_overrides?: Record<string, unknown>;
  cap_overrides?: Record<string, unknown>;
  tool_overrides?: string[] | null;
  // Derived health (separate from lifecycle status): true when any of the
  // agent's tools is on a bank connection that is currently unreachable.
  degraded?: boolean;
  unreachableTools?: string[];
  unreachable_tools?: string[];
};

export type BankConnection = {
  id: string;
  name: string;
  sourceType: "native_mcp" | "openapi" | "manual";
  source_type?: string;
  mcpUrl?: string;
  baseUrl?: string;
  openapiSpec?: string;
  toolCount: number;
  tool_count?: number;
  status: "connected" | "error" | "pending";
  tools?: BankTool[];
  authType?: string;
  credential_type?: string;
  lastSync?: string;
};

export type BankTool = {
  id: string | number;
  name: string;
  method?: string;
  path?: string;
  description: string;
  exposed: boolean;
  convertible?: boolean;
  input_schema?: Record<string, unknown>;
  underlying_ops?: Record<string, unknown>[];
};

// A single fleet-scoped spend cap. Fleet caps are a global governance setting
// (single source of truth) injected into every agent's effective constraints.
export type FleetCap = {
  param: string;
  window: "daily" | "hourly" | "monthly";
  limit_cents: number;
};

// Global fleet caps keyed by tool name.
export type FleetCaps = Record<string, FleetCap[]>;

// A single fleet-scoped rate limit. Like fleet caps, these are a global
// governance setting (single source of truth) injected into every agent's
// effective constraints as shared_rate_limits with scope "fleet".
export type FleetRateLimit = {
  max_calls: number;
  window_seconds: number;
};

// Global fleet rate limits keyed by tool name.
export type FleetRateLimits = Record<string, FleetRateLimit[]>;

export type Policy = {
  id: string | number;
  name: string;
  scope: "global" | "class" | "instance";
  targetId?: string;
  target_id?: string;
  targetName?: string;
  type: "visual" | "rego";
  status: "draft" | "active" | "archived";
  version?: number;
  lastModified?: string;
  created_at?: string;
  updated_at?: string;
  regoSource?: string;
  rego_source?: string;
  visualRule?: VisualRule;
  visualRules?: VisualRule[];
  visual_rules?: VisualRule[];
};

export type VisualRule = {
  action: string;
  effect?: "allow" | "deny";
  conditions: RuleCondition[];
};

export type RuleCondition = {
  field: string;
  operator:
    | "eq"
    | "ne"
    | "lt"
    | "gt"
    | "lte"
    | "gte"
    | "in"
    | "contains"
    | "regex_deny"
    | "regex_allow"
    | "in_list"
    | "outside_hours"
    | "outside_business_hours";
  value: any;
};

export type LatencyBreakdown = {
  totalMs: number;
  total_ms?: number;
  killswitchMs: number;
  killswitch_ms?: number;
  constraintMs: number;
  constraint_ms?: number;
  policyMs: number;
  policy_ms?: number;
  spendMs: number;
  spend_ms?: number;
  downstreamMs: number;
  downstream_ms?: number;
  governanceOverheadMs: number;
  governance_overhead_ms?: number;
};

export type GovernanceEvent = {
  type: string;
  agentId: string;
  agent_id?: string;
  agentClassId: string;
  agent_class_id?: string;
  tool: string;
  decision: "allow" | "deny";
  denyStage?: string;
  deny_stage?: string;
  reason?: string;
  spendDeltaCents?: number;
  spend_delta_cents?: number;
  latency?: LatencyBreakdown;
  timestamp: string;
};

export type ActivityEvent = {
  id: string;
  timestamp: string;
  agentId: string;
  agentClass: string;
  action: string;
  params: Record<string, unknown>;
  responseData?: Record<string, unknown> | string;
  response_data?: Record<string, unknown> | string;
  decision: "allow" | "deny";
  denyStage?: string;
  reason?: string;
  latencyMs: number;
  total_latency_ms?: number;
  governance_overhead_ms?: number;
  bankConnectionId?: string;
};

export type AuditLogEntry = ActivityEvent & {
  entryType?: "action" | "config_change" | "policy_change" | "stop_event";
  oldValue?: string;
  newValue?: string;
  operator?: string;
  prev_hash?: string;
  entry_hash?: string;
  total_latency_ms?: number;
  killswitch_latency_ms?: number;
  policy_latency_ms?: number;
  spend_check_latency_ms?: number;
  constraint_latency_ms?: number;
  downstream_latency_ms?: number;
  governance_overhead_ms?: number;
};

export type PercentileStats = {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  max: number;
  min: number;
};

export type MetricsSnapshot = {
  window_seconds: number;
  total_requests: number;
  allow_count: number;
  deny_count: number;
  deny_by_stage: Record<string, number>;
  latency_percentiles: Record<string, PercentileStats>;
  requests_per_second: number;
  timestamp: number | string;
};

export type FleetStatus = "healthy" | "degraded" | "stopped";

export type FleetStatusResponse = {
  status: FleetStatus;
  fleet_halted: boolean;
  total_instances: number;
  active_instances: number;
  revoked_instances: number;
};

export type StopEvent = {
  id: string;
  timestamp: string;
  scope: "fleet" | "class" | "instance";
  targetId?: string;
  targetName?: string;
  action: "stop" | "resume";
  operator: string;
  reason: string;
};

export type AlertItem = {
  id: string;
  timestamp: string;
  severity: "critical" | "warning" | "info";
  category: "revocation" | "cap_breach" | "emergency_stop" | "policy_change";
  title: string;
  detail: string;
  source: string;
};

export type UserRole = "admin" | "operator" | "auditor";
export type UserStatus = "active" | "suspended";

export type PlatformUser = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
  must_change_password?: boolean;
  created_at?: string;
  updated_at?: string;
  last_login_at?: string | null;
  permissions?: string[];
};

export type RoleDefinition = {
  id: UserRole;
  name: string;
  description: string;
  permissions: string[];
};

export type UserSession = {
  id: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  expires_at: string;
  revoked: boolean;
};
