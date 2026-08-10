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
} from "./types";

// Empty base = same-origin requests; nginx proxies /api/ and /ws/ to the backend.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
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
      defaultCap: c.default_caps?.hourly
        ? {
            amount: (c.default_caps.hourly.amount_cents || 0) / 100,
            window: "day",
          }
        : { amount: 0, window: "day" },
      defaultCaps: c.default_caps || {},
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
      spendToday: i.spend_today ?? 0,
      // 0 renders as "N/A" in SpendBar — honest when the backend sends no cap.
      capToday: i.cap_today ?? 0,
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

  async getAgentSpend(agentId: string): Promise<Record<string, number>> {
    const res = await request<{ spend_counters: Record<string, number> }>(
      `/api/v1/agents/${agentId}/spend`,
    );
    return res.spend_counters;
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

  // Server-side export: full audit log (up to 5000 rows), properly CSV-escaped
  // by the backend — not limited to the rows currently rendered on screen.
  getAuditExportUrl(): string {
    return `${API_BASE}/api/v1/audit/export?format=csv`;
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
};

function strId(id: any): string {
  return id != null ? String(id) : "";
}
