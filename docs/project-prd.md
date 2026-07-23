# Governance Layer for Financial Agents — Project PRD

---

## 1. Problem Statement

Banks are beginning to deploy fleets of autonomous AI agents that act on financial systems — initiating transfers, issuing refunds, updating records — without a human in the loop for every action. Without a control plane between agents and bank systems, a single misbehaving or compromised agent can cause systemic damage before anyone notices. This project builds that control plane: a governance layer that sits between every agent and every bank system, enforcing permissions and spend limits in real time, logging every action, and giving operators an instant kill switch.

## 2. Goals (In Scope)

- Per-agent and per-agent-class permission model (which tools/actions an agent may call, under what constraints).
- Real-time spend caps and budget enforcement, at both agent-instance and agent-class level.
- Instant revocation (single agent) and emergency stop (entire fleet).
- Full, append-only, filterable audit log of every action attempted (allowed and denied).
- Operator dashboard to configure policies, onboard bank systems, monitor live activity, and review audit history.
- Onboarding mechanism for bank systems that don't natively expose MCP (OpenAPI-spec ingestion → tool mapping).
- Custom policy authoring via Rego, with validation and dry-run tooling, in addition to a simpler visual/config-based policy builder.

## 3. Non-Goals (Out of Scope for This Phase)

- **Multi-user delegation.** Agents act with a single service-level identity per bank connection; per-end-user OAuth delegation (agent acting *on behalf of* an individual bank customer) is an explicitly deferred phase-2 concern. Architecture should not preclude adding it later (two-identity model, token vaulting, OAuth 2.1 + Token Exchange), but it is not built now.
- Building the financial agents themselves (only minimal demo agents/tools as props to prove the gateway works).
- Building a production-grade identity provider / full OAuth authorization server.
- Multi-region/HA deployment — single-instance deployment is acceptable for the demo.

## 4. Personas

| Persona | Needs |
|---|---|
| **Operator / Compliance admin** | Configure agent permissions, spend caps, policies; monitor live activity; hit the kill switch when something looks wrong; review audit trail for compliance. |
| **Agent developer / integrator** | Register an agent, know what tools/actions it's permitted, get clear deny reasons when blocked. |
| **Auditor / regulator (read-only)** | Review historical actions, decisions, and reasons, with confidence the log can't be altered. |

## 5. System Architecture

```
                     ┌─────────────────────────┐
                     │   Operator Dashboard    │
                     │   (frontend)            │
                     └───────────┬─────────────┘
                                 │ REST/WS
                     ┌───────────▼──────────────┐
                     │   Backend (FastAPI)      │
                     │  - Config/policy CRUD    │
                     │  - Versioning + audit    │
                     │  - OpenAPI→MCP onboarding│
                     └───────┬───────────┬──────┘
                             │           │
                    ┌────────▼───┐   ┌───▼──────────┐
                    │ PostgreSQL │   │   Redis      │
                    │ (source of │   │ (fast-path   │
                    │  truth,    │   │  cache:      │
                    │  audit log)│   │  kill-switch,│
                    └────────────┘   │  spend       │
                                     │  counters,   │
                                     │  config ver) │
                                     └───────┬──────┘
                                             │ push (pub/sub) + pull (poll version)
                     ┌───────────────────────▼─────────┐
                     │        MCP Gateway (Go)         │
                     │  - MCP server face (to agents)  │
                     │  - MCP client face (to bank MCP)│
                     │  - OPA embedded (Go SDK)        │
                     │  - Lua-scripted Redis hot path  │
                     └───────┬─────────────────┬───────┘
                             │                 │
                    ┌────────▼────────┐ ┌──────▼──────────┐
                    │  Agents (MCP    │ │  Bank Systems   │
                    │  clients)       │ │  (MCP servers / │
                    │                 │ │  OpenAPI-wrapped│
                    └─────────────────┘ └─────────────────┘

              Prometheus + Grafana scrape the Gateway and Backend
              for operational metrics (latency, allow/deny rate, spend utilization).
```

## 6. Core Features (Functional Requirements)

### 6.1 Permission Model
- Two-tier scope: **agent class** (e.g. "payment-agent") defines default allowed tools/actions and default constraints; **agent instance** can override/tighten (never loosen beyond class ceiling, unless explicitly permitted).
- Constraints expressible per allowed action: parameter bounds (e.g. max amount), resource scope (e.g. account segment), time-window restrictions.
- Enforced via OPA (Rego), embedded in the Gateway process — no network hop for policy evaluation.
- Both a visual/config-based policy builder (for common cases) and raw Rego authoring (for complex/custom logic), with a validator (`opa parse` / `opa test`) and a dry-run tool (evaluate a candidate policy against recent historical actions and show what would change before activating it).

### 6.2 Spend Caps & Budgets
- Real-time, atomic enforcement at both **instance level** and **class level** (instance usage rolls up into class usage).
- Enforced via a single Redis Lua script per action: check kill-switch → check revocation → check both cap levels → atomically reserve (increment) if allowed.
- Generalized "budget" concept: not just currency — also usable for call-volume, records-touched, or other rate/quantity limits per action type.
- On a downstream policy (OPA) denial after reservation, the reservation is released (compensating decrement) so denied actions never consume budget.

### 6.3 Revocation & Emergency Stop
- **Per-agent-instance revocation**: instantly blocks all future actions from that instance.
- **Per-agent-class revocation**: instantly blocks all instances of that class.
- **Fleet-wide emergency stop**: instantly blocks all agents, regardless of individual permissions.
- All three are Redis-backed flags checked first, before OPA evaluation — the cheapest, most catastrophic checks always run first and have the fewest dependencies.
- Fail-closed: if Redis, OPA, or config reload is unreachable/erroring, the default behavior is **deny**, never allow.

### 6.4 Audit Log
- Append-only Postgres table. Every action attempt (allowed or denied) is logged with: agent id, agent class, action/tool, parameters, decision, deny reason (if any), timestamp, latency.
- Rich filtering in the dashboard: by agent, class, action type, outcome, bank system, time range.
- Config/policy changes are also versioned and logged (who changed what, when, from what value to what value).

### 6.5 Bank System Onboarding
- If a bank system already exposes an MCP server → register directly.
- If not → upload an OpenAPI spec; the backend parses operations and generates candidate MCP tool definitions; operator selects/renames/groups endpoints into exposed tools (some tools may internally call multiple endpoints).
- Fallback tiers if no spec exists: convert from Postman/other docs, or use a guided manual "define a tool" wizard, or (last resort) a hand-coded adapter.
- Credentials for each bank connection are stored encrypted, keyed by connection id — never exposed to agents. The gateway injects the real credential at call time.

### 6.6 Operator Dashboard
See separate Frontend PRD (`frontend-prompt.md`) for full detail. Summary: command-center overview, agent/class management, policy authoring, bank connection onboarding, live activity feed, audit log, emergency stop controls, settings.

## 7. Data Model (Key Entities)

- `agent_class` — id, name, default allowed tools, default constraints, default caps.
- `agent_instance` — id, class_id, overrides (constraints/caps), status (active/revoked).
- `bank_connection` — id, name, source type (native MCP / OpenAPI-derived / manual), credential ref.
- `tool` — id, bank_connection_id, name, underlying operation(s), input schema, exposed (bool).
- `policy` — id, scope (class/instance), type (visual-config / rego), version, rego_source (if applicable), status (draft/active).
- `audit_log` — append-only: id, agent_instance_id, action, params, decision, reason, latency_ms, timestamp.
- `config_version` — monotonically increasing version marker used for gateway cache reconciliation.

## 8. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Added latency per action (kill-switch + spend + policy eval) | ~1–3ms (Redis + in-process OPA, co-located) |
| Config propagation to gateway | Push via pub/sub (near-instant) + pull-based version poll every 10–30s as reconciliation safety net |
| Failure mode | Fail-closed (deny) on any dependency failure |
| Audit durability | Append-only, versioned, no destructive updates |
| Observability | Prometheus metrics (allow/deny rate, decision latency percentiles, spend utilization) + Grafana dashboard |

## 9. Success Metrics (Demo/Judging Alignment)

- **Policy enforcement accuracy**: demo a denied action (over cap, out of scope, revoked) always correctly denied, with a clear reason.
- **Low latency**: show measured p50/p95 decision latency live via Grafana during a demo load.
- **Auditability**: show a full reconstruction of "why did this get denied" from the audit log for a given action.
- **Kill switch speed**: demo fleet-wide stop taking effect on the very next action attempt across multiple agents simultaneously.

## 10. Suggested Build Order (Hackathon Timeline)

1. Core Gateway skeleton (Go): MCP server face, static tool routing, no policy yet.
2. Redis Lua hot path: kill-switch + revocation + spend cap (instance + class).
3. Embed OPA, wire in basic Rego policies for permission scope.
4. Postgres schema + FastAPI backend: agent/class CRUD, policy CRUD, audit log write path.
5. Config propagation: push (pub/sub) + pull (version poll) between backend and gateway.
6. OpenAPI → MCP tool onboarding flow (can start with FastMCP/openapi-mcp-generator as base).
7. Frontend dashboard (see Frontend PRD).
8. Prometheus/Grafana wiring + latency measurement.
9. Demo script: register agent → set caps → run agent → breach cap → deny → revoke → emergency stop → show audit trail end-to-end.

## 11. Open Risks / Future Work

- Multi-user OAuth delegation (phase 2, explicitly deferred).
- Rego dry-run tooling depth (how much historical-replay fidelity is feasible in the timeframe).
- Async/long-running bank actions and what "emergency stop" means for in-flight calls (stops new dispatch; in-flight actions resolve and are logged normally).
