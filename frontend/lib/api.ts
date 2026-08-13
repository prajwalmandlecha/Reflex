// Typed API client layer communicating directly with FastAPI control-plane backend.

import type {
  AgentClass,
  AgentInstance,
  BankConnection,
  Policy,
  AuditLogEntry,
  FleetStatusResponse,
  MetricsSnapshot,
  BankTool,
  FleetCaps,
  FleetRateLimits,
} from "./types";

// Empty base = same-origin requests; nginx proxies /api/ and /ws/ to the backend.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("reflex_auth_token")
      : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const errorText = await res.text();
    // FastAPI returns { "detail": ... }. For our constraint validator, detail
    // is { message, errors: [...] } — surface those so the class editor can
    // tell the operator exactly which tool/key/money field was rejected.
    let message = errorText;
    try {
      const parsed = JSON.parse(errorText);
      const detail = parsed?.detail;
      if (typeof detail === "string") {
        message = detail;
      } else if (detail && typeof detail === "object") {
        const parts = [
          detail.message,
          ...(Array.isArray(detail.errors) ? detail.errors : []),
        ].filter(Boolean);
        message = parts.join(": ") || errorText;
      }
    } catch {
      // Non-JSON body — fall back to the raw text.
    }
    throw new Error(`${message} (${res.status})`);
  }
  // 204 No Content (or any empty body) has no JSON to parse.
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function requestText(
  path: string,
  options?: RequestInit,
): Promise<string> {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("reflex_auth_token")
      : null;
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (token && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Export failed (${res.status}): ${errorText}`);
  }
  return await res.text();
}

export const api = {
  // --- Agent Classes ---
  async getAgentClasses(): Promise<AgentClass[]> {
    const raw = await request<any[]>("/api/v1/classes");
    return raw.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description || "",
      allowedTools: c.default_allowed_tools || c.allowedTools || [],
      defaultAllowedTools: c.default_allowed_tools || [],
      defaultConstraints: c.default_constraints || c.defaultConstraints || {},
      instanceCount: c.instance_count ?? 0,
      status: c.status || "active",
      created_at: c.created_at,
      updated_at: c.updated_at,
      unreachableTools: c.unreachable_tools || c.unreachableTools || [],
      unreachable_tools: c.unreachable_tools,
    }));
  },

  async createAgentClass(cls: Partial<AgentClass>): Promise<AgentClass> {
    return request<AgentClass>("/api/v1/classes", {
      method: "POST",
      body: JSON.stringify(cls),
    });
  },

  async updateAgentClass(
    id: string,
    cls: Partial<AgentClass>,
  ): Promise<AgentClass> {
    return request<AgentClass>(`/api/v1/classes/${id}`, {
      method: "PUT",
      body: JSON.stringify(cls),
    });
  },

  async revokeAgentClass(id: string): Promise<void> {
    await request(`/api/v1/classes/${id}/revoke`, { method: "POST" });
  },

  async reviveAgentClass(id: string): Promise<void> {
    await request(`/api/v1/classes/${id}/revoke`, { method: "DELETE" });
  },

  async deleteAgentClass(id: string): Promise<void> {
    await request(`/api/v1/classes/${id}`, { method: "DELETE" });
  },

  // --- Agent Instances ---
  async getAgentInstances(): Promise<AgentInstance[]> {
    const raw = await request<any[]>("/api/v1/agents");
    return raw.map((i) => ({
      id: i.id,
      classId: i.class_id || i.classId,
      class_id: i.class_id,
      status: i.status || "active",
      lastAction: i.last_action || "Idle",
      lastSeen: i.last_seen || "Just now",
      className: i.class_name || i.className || i.class_id,
      class_name: i.class_name,
      constraint_overrides: i.constraint_overrides || {},
      cap_overrides: i.cap_overrides || {},
      tool_overrides: i.tool_overrides ?? null,
      degraded: i.degraded ?? false,
      unreachableTools: i.unreachable_tools || i.unreachableTools || [],
      unreachable_tools: i.unreachable_tools,
    }));
  },

  async registerAgentInstance(
    inst: Partial<AgentInstance>,
  ): Promise<AgentInstance> {
    return request<AgentInstance>("/api/v1/agents", {
      method: "POST",
      body: JSON.stringify(inst),
    });
  },

  async updateAgentInstance(
    agentId: string,
    inst: Partial<{
      class_id?: string;
      status?: string;
      constraint_overrides?: Record<string, unknown>;
      cap_overrides?: Record<string, unknown>;
      tool_overrides?: string[] | null;
    }>,
  ): Promise<AgentInstance> {
    return request<AgentInstance>(`/api/v1/agents/${agentId}`, {
      method: "PUT",
      body: JSON.stringify(inst),
    });
  },

  async revokeAgent(agentId: string): Promise<void> {
    await request(`/api/v1/agents/${agentId}/revoke`, { method: "POST" });
  },

  async reviveAgent(agentId: string): Promise<void> {
    await request(`/api/v1/agents/${agentId}/revoke`, { method: "DELETE" });
  },

  async deleteAgentInstance(agentId: string): Promise<void> {
    await request(`/api/v1/agents/${agentId}`, { method: "DELETE" });
  },

  // --- Agent JWT Minting ---
  async mintToken(
    agentId: string,
    agentKind: string,
    policyVersion?: number,
  ): Promise<{ token: string; agent_id: string; expires_in_minutes: number }> {
    return request(
      `/api/v1/tokens?agent_id=${encodeURIComponent(agentId)}&agent_kind=${encodeURIComponent(agentKind)}${policyVersion ? `&policy_version=${policyVersion}` : ""}`,
      {
        method: "POST",
      },
    );
  },

  // --- Bank Connections & Tools ---
  async getBankConnections(): Promise<BankConnection[]> {
    const raw = await request<any[]>("/api/v1/connections");
    return raw.map((b) => ({
      id: b.id,
      name: b.name,
      sourceType: b.source_type || b.sourceType,
      source_type: b.source_type,
      mcpUrl: b.mcp_url || b.mcpUrl,
      baseUrl: b.base_url || b.baseUrl,
      openapiSpec: b.openapi_spec || b.openapiSpec,
      toolCount: b.tool_count ?? b.toolCount ?? (b.tools ? b.tools.length : 0),
      tool_count: b.tool_count,
      // No silent "connected" fallback — status is derived server-side from a real probe.
      status: b.status || "pending",
      tools: b.tools || [],
      authType: b.credential_type || undefined,
      lastSync: b.updated_at || undefined,
    }));
  },

  async getAllTools(): Promise<BankTool[]> {
    const raw = await request<any[]>("/api/v1/tools");
    return raw.map((t) => ({
      id: String(t.id),
      name: t.name,
      description: t.description || "",
      exposed: t.exposed,
      input_schema: t.input_schema || {},
      bank_connection_id: t.bank_connection_id,
    }));
  },

  async createBankConnection(
    conn: Partial<BankConnection>,
  ): Promise<BankConnection> {
    return request<BankConnection>("/api/v1/connections", {
      method: "POST",
      body: JSON.stringify(conn),
    });
  },

  async deleteBankConnection(id: string): Promise<void> {
    await request(`/api/v1/connections/${id}`, { method: "DELETE" });
  },

  async syncBankConnection(id: string): Promise<BankConnection> {
    return request<BankConnection>(`/api/v1/connections/${id}/sync`, {
      method: "POST",
    });
  },

  async clearAllConnections(): Promise<void> {
    await request("/api/v1/connections/all", { method: "DELETE" });
  },

  async registerOpenAPISpec(
    connectionId: string,
    spec: string,
    baseUrl?: string,
    name?: string,
  ): Promise<{ tool_count: number }> {
    return request<{ tool_count: number }>(
      `/api/v1/connections/${connectionId}/openapi`,
      {
        method: "POST",
        body: JSON.stringify({ spec, base_url: baseUrl, name }),
      },
    );
  },

  // --- Policies ---
  async getPolicies(): Promise<Policy[]> {
    const raw = await request<any[]>("/api/v1/policies");
    return raw.map((p) => ({
      id: strId(p.id),
      name: p.name,
      scope: p.scope || "global",
      type: p.type || "rego",
      version: p.version || 1,
      regoSource: p.rego_source || p.regoSource || "",
      rego_source: p.rego_source,
      visualRules: p.visual_rules || p.visualRules || [],
      visual_rules: p.visual_rules,
      status: p.status || "active",
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));
  },

  async createPolicy(policy: Partial<Policy>): Promise<Policy> {
    return request<Policy>("/api/v1/policies", {
      method: "POST",
      body: JSON.stringify(policy),
    });
  },

  async updatePolicy(id: string, policy: Partial<Policy>): Promise<Policy> {
    return request<Policy>(`/api/v1/policies/${id}`, {
      method: "PUT",
      body: JSON.stringify(policy),
    });
  },

  async deletePolicy(id: string): Promise<void> {
    await request(`/api/v1/policies/${id}`, { method: "DELETE" });
  },

  async validatePolicy(
    regoSource: string,
  ): Promise<{ valid: boolean; errors?: string[] }> {
    return request<{ valid: boolean; errors?: string[] }>(
      "/api/v1/policies/validate",
      {
        method: "POST",
        body: JSON.stringify({ rego_source: regoSource }),
      },
    );
  },

  async compileVisualRules(rules: any[]): Promise<{ rego_source: string }> {
    return request<{ rego_source: string }>("/api/v1/policies/compile-visual", {
      method: "POST",
      body: JSON.stringify(rules),
    });
  },

  async testPolicyInput(payload: {
    rego_source?: string;
    visual_rules?: any[];
    input_payload: any;
  }): Promise<{
    allowed: boolean;
    decision: string;
    reasons: string[];
    rego_source: string;
  }> {
    return request<any>("/api/v1/policies/test-input", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // --- Audit Log ---
  async verifyAuditLog(): Promise<{
    valid: boolean;
    total_records: number;
    verified_until_id: number;
    error_message?: string;
  }> {
    return request<any>("/api/v1/audit/verify");
  },

  getAuditExportUrl(): string {
    return `${API_BASE}/api/v1/audit/export?format=csv`;
  },

  async exportAuditLogCsv(): Promise<void> {
    const text = await requestText("/api/v1/audit/export?format=csv");
    const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `audit_log_${new Date().toISOString().slice(0, 10)}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  async getSystemAuditLog(): Promise<any[]> {
    return request<any[]>("/api/v1/audit/system-log");
  },

  async getAuditLog(params?: {
    agentId?: string;
    agentClassId?: string;
    action?: string;
    decision?: string;
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    const query = new URLSearchParams();
    if (params?.agentId) query.set("agent_id", params.agentId);
    if (params?.agentClassId) query.set("agent_class_id", params.agentClassId);
    if (params?.action) query.set("action", params.action);
    if (params?.decision) query.set("decision", params.decision);
    if (params?.limit) query.set("limit", params.limit.toString());

    const raw = await request<any[]>(`/api/v1/audit?${query.toString()}`);
    return raw.map((a) => ({
      id: String(a.id),
      timestamp: a.ts || a.timestamp,
      agentId: a.agent_id || a.agentId,
      agentClass: a.agent_class_id || a.agentClassId || a.agentClass || "",
      agentClassId: a.agent_class_id || a.agentClassId || "",
      action: a.action,
      bankConnectionId: a.bank_connection_id || a.bankConnectionId || "",
      params: a.params || {},
      responseData: a.response_data || a.responseData || a.result || null,
      response_data: a.response_data || a.responseData || a.result || null,
      decision: a.decision,
      denyStage: a.deny_stage || a.denyStage || "",
      reason: a.reason || "",
      spendDeltaCents: a.spend_delta || a.spendDeltaCents || 0,
      latencyMs: a.total_latency_ms || a.totalLatencyMs || 0,
      totalLatencyMs: a.total_latency_ms || a.totalLatencyMs || 0,
      killswitch_latency_ms: a.killswitch_latency_ms || 0,
      policy_latency_ms: a.policy_latency_ms || 0,
      spend_check_latency_ms: a.spend_check_latency_ms || 0,
      constraint_latency_ms: a.constraint_latency_ms || 0,
      downstream_latency_ms: a.downstream_latency_ms || 0,
      governance_overhead_ms: a.governance_overhead_ms || 0,
      governanceOverheadMs:
        a.governance_overhead_ms || a.governanceOverheadMs || 0,
      prev_hash: a.prev_hash || a.prevHash || "",
      entry_hash: a.entry_hash || a.entryHash || "",
    }));
  },

  async verifyAuditChain(): Promise<{
    valid: boolean;
    total_records: number;
    verified_until_id: number;
  }> {
    return request<{
      valid: boolean;
      total_records: number;
      verified_until_id: number;
    }>("/api/v1/audit/verify");
  },

  // --- Emergency Stop & Fleet Control ---
  async haltFleet(reason?: string): Promise<FleetStatusResponse> {
    return request<FleetStatusResponse>("/api/v1/fleet/halt", {
      method: "POST",
      body: JSON.stringify({
        reason:
          reason || "Manual emergency stop triggered via operator console",
      }),
    });
  },

  async resumeFleet(): Promise<FleetStatusResponse> {
    return request<FleetStatusResponse>("/api/v1/fleet/halt", {
      method: "DELETE",
    });
  },

  async getFleetStatus(): Promise<FleetStatusResponse> {
    return request<FleetStatusResponse>("/api/v1/fleet/status");
  },

  async getSystemHealth(): Promise<{
    gateway: string;
    redis: string;
    opa: string;
    database: string;
  }> {
    return request<any>("/api/v1/fleet/system-health");
  },

  // --- Global Fleet Caps & Rate Limits ---
  async getFleetCaps(): Promise<{
    caps: FleetCaps;
    rate_limits: FleetRateLimits;
  }> {
    return request<{ caps: FleetCaps; rate_limits: FleetRateLimits }>(
      "/api/v1/fleet-caps",
    );
  },

  async updateFleetCaps(
    caps: FleetCaps,
    rate_limits: FleetRateLimits,
  ): Promise<{ caps: FleetCaps; rate_limits: FleetRateLimits }> {
    return request<{ caps: FleetCaps; rate_limits: FleetRateLimits }>(
      "/api/v1/fleet-caps",
      {
        method: "PUT",
        body: JSON.stringify({ caps, rate_limits }),
      },
    );
  },

  // --- Metrics Snapshot ---
  async getMetricsSnapshot(): Promise<MetricsSnapshot> {
    return request<MetricsSnapshot>("/api/v1/metrics/snapshot");
  },

  // --- Dashboard Summary & Activity ---
  async getDashboardSummary(): Promise<any> {
    return request<any>("/api/v1/dashboard/summary");
  },

  async getDashboardActivity(limit = 50): Promise<any[]> {
    return request<any[]>(`/api/v1/dashboard/activity?limit=${limit}`);
  },

  async getStopEvents(limit = 50): Promise<any[]> {
    return request<any[]>(`/api/v1/fleet/events?limit=${limit}`);
  },

  async updateTool(toolId: number, data: Partial<BankTool>): Promise<BankTool> {
    return request<BankTool>(`/api/v1/tools/${toolId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  // --- Auth & User Management ---
  async login(email: string, password: string): Promise<any> {
    return request<any>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  async getMe(): Promise<any> {
    return request<any>("/api/v1/auth/me");
  },

  async logout(): Promise<void> {
    await request("/api/v1/auth/logout", { method: "POST" });
  },

  async changePassword(oldPassword: string, newPassword: string): Promise<any> {
    return request<any>("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        old_password: oldPassword,
        new_password: newPassword,
      }),
    });
  },

  async getUsers(params?: {
    query?: string;
    role?: string;
    status?: string;
  }): Promise<any[]> {
    const q = new URLSearchParams();
    if (params?.query) q.set("query", params.query);
    if (params?.role) q.set("role", params.role);
    if (params?.status) q.set("status", params.status);
    return request<any[]>(`/api/v1/users?${q.toString()}`);
  },

  async createUser(userData: {
    email: string;
    full_name: string;
    password: string;
    role: string;
    must_change_password?: boolean;
  }): Promise<any> {
    return request<any>("/api/v1/users", {
      method: "POST",
      body: JSON.stringify(userData),
    });
  },

  async updateUser(
    userId: string,
    data: { full_name?: string; email?: string; role?: string },
  ): Promise<any> {
    return request<any>(`/api/v1/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async suspendUser(
    userId: string,
    action: "suspend" | "activate",
  ): Promise<any> {
    return request<any>(`/api/v1/users/${userId}/suspend?action=${action}`, {
      method: "POST",
    });
  },

  async resetUserPassword(userId: string, newPassword: string): Promise<any> {
    return request<any>(`/api/v1/users/${userId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ new_password: newPassword }),
    });
  },

  async deleteUser(userId: string): Promise<any> {
    return request<any>(`/api/v1/users/${userId}`, { method: "DELETE" });
  },

  async getRolePermissionsMatrix(): Promise<any> {
    return request<any>("/api/v1/users/roles/permissions");
  },
};

function strId(id: any): string {
  return id != null ? String(id) : "";
}
