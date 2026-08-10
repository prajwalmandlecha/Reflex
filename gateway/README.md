# Reflex Gateway — In-Flight Security Proxy & Policy Engine

[![Go Version](https://img.shields.io/badge/Go-1.26-blue.svg)](https://golang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7.2-red.svg)](https://redis.io)
[![OPA](https://img.shields.io/badge/OPA-v1.0-blueviolet.svg)](https://openpolicyagent.org)
[![sqlc](https://img.shields.io/badge/sqlc-v1.31-orange.svg)](https://sqlc.dev)

An **In-Flight Security Interceptor & Transparent Reverse Proxy** for AI agents operating in financial environments. Reflex Gateway enforces per-agent tool whitelists, real-time spend limits, instant killswitches, OPA/Rego policy checks, and a SHA-256 hash-chained audit ledger over the **Model Context Protocol (MCP)**.

> **Control plane lives elsewhere.** Operator actions (minting tokens, revoking agents, fleet halt, policy CRUD, audit export) are served by the **Python FastAPI backend** on `:8000` (`/api/v1/...`), not by this gateway. The gateway is the **data plane**: it proxies and governs agent MCP traffic.

---

## 🏛️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  AI AGENTS (VS Code Copilot, Claude Desktop, CrewAI, etc.)  │
└──────────────────────────────┬──────────────────────────────┘
                               │ MCP JSON-RPC over HTTP (Bearer JWT)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  REFLEX GATEWAY (:8080)  — single /mcp endpoint             │
│                                                             │
│  1. Authenticate agent (mandatory Bearer JWT)               │
│  2. Route tools/call → downstream via tool_name             │
│     (agp:tool_routing in Redis)                             │
│  3. Governance gauntlet (tools/call, resources/read,        │
│     prompts/get):                                           │
│     ├── [1] Sub-ms Redis Killswitch / fleet-halt check      │
│     ├── [2] Static constraints (time windows) + fail-closed │
│     │       money-field enforcement (tools only)            │
│     ├── [3] Embedded OPA Rego policy engine (ABAC)          │
│     └── [4] Atomic Redis Lua commit: rate limit + spend caps│
│  4. SHA-256 hash-chained audit ledger (batched to Postgres) │
│  5. Transparent forwarding to downstream target             │
└─────────────┬─────────────────┬─────────────────┬───────────┘
              │                 │                 │
              ▼                 ▼                 ▼
   ┌──────────────────┐┌──────────────────┐┌──────────────────┐
   │ Bank Identity    ││ Bank Payments    ││ Bank Risk        │
   │ MCP Server       ││ MCP Server       ││ MCP Server       │
   └──────────────────┘└──────────────────┘└──────────────────┘
```

Downstream targets are a mix of **native MCP servers** (from `MCP_TARGETS` env + runtime-registered `native_mcp` bank connections) and **OpenAPI specs virtualized as MCP tools** (from `openapi` bank connections). Both are hot-reloaded from Redis on `config:updates`.

---

## ✨ Key Features

1. **Transparent MCP reverse proxy** — single `/mcp` endpoint; routes `tools/call` to the correct downstream by tool name.
2. **Governed tools, resources & prompts** — `tools/call`, `resources/read`, and `prompts/get` all pass through the governance pipeline. `resources/list` / `prompts/list` / `tools/list` are aggregated across targets, deduped, and filtered by the agent's whitelist.
3. **Mandatory JWT authn** — HS256 Bearer tokens validated with issuer check; identity is derived solely from the token claims.
4. **Embedded OPA/Rego authz** — per-policy modules + aggregator (deny > allow > default-deny), hot-reloaded from Postgres/Redis.
5. **Atomic spend & rate limiting** — a single Redis Lua script commits rate-limit (sliding-window sub-buckets) and hierarchical spend caps (agent-hourly / class-daily / fleet-daily) all-or-nothing; committed budget is **rolled back** if the downstream call fails.
6. **Sub-ms killswitch** — fleet / class / agent halt via Redis keys.
7. **SHA-256 hash-chained audit ledger** — batched transactional writes via sqlc; chain re-anchors on flush failure so a transient DB error can't fork the chain. Sensitive params (tokens, secrets) are redacted before logging.
8. **OpenAPI virtualization** — OpenAPI specs become MCP tools automatically.
9. **Prometheus telemetry** — decision counters and per-stage latency histograms at `:9090/metrics`.

---

## 📡 API Reference

### Agent-facing MCP proxy (`:8080`)

| Route       | Description                                                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /mcp` | Single MCP JSON-RPC endpoint. Handles `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`, `notifications/*`. Routing is by tool name, not by path. |

**Required headers:**

- `Authorization: Bearer <minted_jwt>` — **required**. Minted by the backend (`POST :8000/api/v1/tokens`). Identity is derived solely from the token claims.

### Operator endpoints on the gateway (`:8080`)

| Method | Endpoint           | Description                                                                        |
| ------ | ------------------ | ---------------------------------------------------------------------------------- |
| `GET`  | `/health`          | Health check. Returns `{"status":"ok","service":"agp-gateway"}`                    |
| `GET`  | `/v1/audit/verify` | Verify the SHA-256 audit ledger (recomputes every `entry_hash` and checks linkage) |
| `GET`  | `:9090/metrics`    | Prometheus metrics exposition                                                      |

> All other operator actions (token minting, agent/fleet control, policies, connections, dashboard, audit list/export) are on the **backend** at `:8000/api/v1/...`. See the root README.

---

## 🚀 Running

The gateway runs as part of the full stack from the repo root:

```bash
docker compose up -d --build
```

- Gateway MCP proxy: `http://localhost:8080/mcp`
- Audit verify: `http://localhost:8080/v1/audit/verify`
- Metrics: `http://localhost:9090/metrics`

Configuration is via environment variables (see `docker-compose.yml` and `.env.example`):

| Var                                 | Default                                 | Notes                                                                                                             |
| ----------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_MCP_PORT`                  | `8080`                                  | Agent-facing port                                                                                                 |
| `GATEWAY_METRICS_PORT`              | `9090`                                  | Metrics port                                                                                                      |
| `REDIS_ADDR`                        | `localhost:6379`                        |                                                                                                                   |
| `POSTGRES_DSN`                      | `postgres://agp:agp@localhost:5433/agp` |                                                                                                                   |
| `BACKEND_URL`                       | `http://localhost:8000`                 | Config-cache fallback                                                                                             |
| `GATEWAY_JWT_SECRET` / `JWT_SECRET` | —                                       | **Required.** Must match the backend. Gateway refuses to boot with the built-in dev default unless `AGP_ENV=dev`. |
| `GATEWAY_JWT_ISSUER` / `JWT_ISSUER` | `agp-gateway`                           | Validated on every token                                                                                          |
| `MCP_TARGETS`                       | —                                       | JSON map of static native-MCP targets; merged with runtime `native_mcp` connections                               |

---

## 📂 Project Structure

```
gateway/
├── cmd/
│   ├── gateway/main.go         <-- Main gateway server (chi router, hardened HTTP)
│   └── inspect-bank/main.go    <-- Dev/debug CLI: probe a downstream MCP server
│
├── db/
│   ├── schema.sql              <-- Sanitized copy of the schema for sqlc
│   └── queries/                <-- sqlc query definitions (audit, policies)
│
├── internal/
│   ├── adapter/openapi.go      <-- OpenAPI spec → MCP tool virtualization
│   ├── audit/                  <-- Hash-chained logger + integrity verifier
│   ├── authn/jwt.go            <-- JWT mint/validate (issuer-checked)
│   ├── authz/engine.go         <-- Embedded OPA Rego engine (hot-reload)
│   ├── config/config.go        <-- Env config parser
│   ├── configcache/cache.go    <-- Agent config cache (memory → Redis → backend)
│   ├── constraints/checker.go  <-- Time windows, rate limits, money-field extraction
│   ├── db/                     <-- sqlc-generated query package
│   ├── killswitch/switch.go    <-- Redis fleet/class/agent killswitch
│   ├── metrics/metrics.go      <-- Prometheus instruments
│   ├── proxy/mcp_proxy.go      <-- Governance pipeline + MCP proxy
│   └── spend/limiter.go        <-- Atomic Redis Lua spend/rate commit + rollback
│
├── policies/default.rego       <-- Reference default policy (runtime fallback is inline)
├── Dockerfile
└── sqlc.yaml
```
