# Reflex Gateway — In-Flight Security Proxy & Policy Engine

[![Go Version](https://img.shields.io/badge/Go-1.26-blue.svg)](https://golang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7.2-red.svg)](https://redis.io)
[![OPA](https://img.shields.io/badge/OPA-v1.0-blueviolet.svg)](https://openpolicyagent.org)
[![Goose](https://img.shields.io/badge/Goose-v3.27-brightgreen.svg)](https://pressly.github.io/goose)
[![sqlc](https://img.shields.io/badge/sqlc-v1.31-orange.svg)](https://sqlc.dev)

An enterprise-grade **In-Flight Security Interceptor & Transparent Reverse Proxy** for AI agents operating in financial environments. Reflex Gateway enforces granular per-agent permission profiles, real-time spend limits, instant killswitches, cryptographic audit trails, and dynamic tool schema filtering over the **Model Context Protocol (MCP)**.

---

## 🏛️ Architecture Overview

Reflex Gateway sits transparently between **AI Agents** (LangChain, CrewAI, AutoGen, VS Code Copilot, Claude Desktop) and **Downstream Target Services** (Core Banking, Payments, Risk Ops):

<p align="center">
  <img src="../docs/Architecture-Diagram.png" alt="Reflex Gateway Architecture Diagram" width="100%" />
</p>

### Pipeline Execution Flow
```
┌─────────────────────────────────────────────────────────────┐
│  AI AGENTS (VS Code Copilot, Claude Desktop, CrewAI, etc.)  │
└──────────────────────────────┬──────────────────────────────┘
                               │ MCP JSON-RPC over HTTP
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  REFLEX GATEWAY (:8080)                                     │
│                                                             │
│  1. Identify Agent (JWT / X-Agent-ID Headers)               │
│  2. Dynamic Discovery Schema Filtering (`tools/list`)       │
│  3. In-Flight Governance Gauntlet (`tools/call`):           │
│     ├── [A] Sub-ms Redis Killswitch & Fleet Halt Check      │
│     ├── [B] Embedded OPA Rego Policy Engine Check (ABAC)    │
│     ├── [C] Atomic Redis Lua Spend Cap Check                │
│     └── [D] SHA-256 Hash-Chained Audit Ledger Log           │
│                                                             │
│  4. Transparent Forwarding to Downstream Target Server      │
└─────────────┬─────────────────┬─────────────────┬───────────┘
              │                 │                 │
              ▼                 ▼                 ▼
   ┌──────────────────┐┌──────────────────┐┌──────────────────┐
   │ Bank Identity    ││ Bank Payments    ││ Bank Risk        │
   │ MCP Server       ││ MCP Server       ││ MCP Server       │
   │ (:31100)         ││ (:31200)         ││ (:31400)         │
   └──────────────────┘└──────────────────┘└──────────────────┘
```

---

## ✨ Key Features

1. **Transparent MCP Reverse Proxy (Multi-Server Routing):**
   Proxies standard MCP JSON-RPC endpoints to multiple downstream target servers (`bank-identity`, `bank-payments`, `bank-financial`, `bank-risk`).

2. **Attribute-Based Agent Profiles & Tool Whitelisting (ABAC):**
   Decouples Agent Profiles (templates/classes) from Agent Instances (deployed bots). Profiles define explicit tool call whitelists (`allowed_tools`) and spend limits.

3. **Dynamic Discovery Schema Filtering (`tools/list`):**
   When an agent connects and sends `tools/list`, the Gateway filters the returned schema so the agent **only sees authorized tools**. Prevents LLM hallucinations and unauthorized tool invocation attempts.

4. **OpenAPI-to-MCP Virtualization:**
   Ingests legacy OpenAPI/Swagger specs (`swagger.json`/`openapi.yaml`) and dynamically virtualizes REST APIs as AI-callable MCP tools without requiring separate server wrappers.

5. **Sub-Millisecond Emergency Killswitch & Fleet Halt:**
   Per-agent revocations (`POST /v1/agents/{id}/revoke`) and fleet-wide panic button (`POST /v1/fleet/halt`) backed by Redis pipelines (<1ms latency impact).

6. **Embedded OPA Rego Policy Engine:**
   Lock-free, in-memory OPA evaluation engine with atomic hot-reloading from PostgreSQL.

7. **Atomic Real-Time Spend Limit Engine:**
   Atomic Redis Lua scripts prevent race conditions when enforcing hourly and daily budget ceilings across agent instances.

8. **Cryptographic SHA-256 Audit Ledger:**
   Append-only hash-chained audit log stored in PostgreSQL (`entry_hash = SHA-256(prev_hash || row_json)`). Built-in verification endpoint (`GET /v1/audit/verify`).

9. **Goose Migrations & Type-Safe sqlc Data Layer:**
   Version-controlled schema migrations managed via **Goose** (`migrations/001_init.sql`) and compile-time type-safe Go query code generated via **sqlc** (`internal/db/`).

10. **Prometheus Telemetry Stream:**
    Real-time decision counters and latency histograms exported at `:9090/metrics`.

---

## 📡 API Reference

### 1. Agent-Facing MCP Proxy Endpoints (`:8080`)

All MCP agents send JSON-RPC HTTP POST requests to these endpoints:

| Route Path | Downstream Target Server | Description |
|---|---|---|
| `/mcp` | Default MCP Target | Multi-purpose MCP proxy route |
| `/mcp/bank-identity` | `http://20.2.83.126:31100/mcp` | Bank Identity & Contacts MCP |
| `/mcp/bank-payments` | `http://20.2.83.126:31200/mcp` | Bank Payments & Wire Ledger MCP |
| `/mcp/bank-financial` | `http://20.2.83.126:31300/mcp` | Bank Financial Insights & Budgets MCP |
| `/mcp/bank-risk` | `http://20.2.83.126:31400/mcp` | Bank Fraud & Risk Ops MCP |

**Required Agent Identity Headers:**
* `X-Agent-ID`: `pay-agent-01` *(or any unique agent instance ID)*
* `X-Agent-Kind`: `payments` *(options: `conversational`, `payments`, `trading`, `ops`, `custom`)*
* *(Or Bearer Token: `Authorization: Bearer <minted_jwt>`)*

---

### 2. Operator Control Plane REST Endpoints (`:8080/v1`)

| Method | Endpoint | Description | Sample Request Payload / Parameters |
|---|---|---|---|
| `POST` | `/v1/token` | Mint JWT Bearer Token for an Agent | `?agent_id=agent-01&agent_kind=payments` |
| `POST` | `/v1/agents/{id}/revoke` | Revoke individual agent instance | *(No body required)* |
| `DELETE` | `/v1/agents/{id}/revoke` | Revive individual agent instance | *(No body required)* |
| `POST` | `/v1/fleet/halt` | Fleet-wide Emergency Stop (Panic Button) | *(No body required)* |
| `DELETE` | `/v1/fleet/halt` | Resume Fleet Operations | *(No body required)* |
| `GET` | `/v1/profiles` | List all agent profiles & tool whitelists | *(No body required)* |
| `POST` | `/v1/profiles` | Create or update agent profile | `{"profile_id":"custom_v1","profile_name":"Custom Bot","allowed_tools":["get_balance"],"hourly_spend_cap_cents":100000}` |
| `POST` | `/v1/instances` | Register bot instance attached to profile | `{"agent_id":"bot-01","profile_id":"custom_v1","status":"active"}` |
| `POST` | `/v1/openapi/register` | Dynamically registers an OpenAPI spec as a virtual MCP server | `{"name":"bank-api","spec_url":"..."}` |
| `GET` | `/v1/audit/verify` | Verify cryptographic SHA-256 audit ledger | *(No body required)* |
| `GET` | `/health` | Health Check Endpoint | Returns `{"status":"ok"}` |
| `GET` | `:9090/metrics` | Prometheus Metrics Endpoint | Returns Prometheus telemetry exposition |

---

## 🚀 How to Run & Test

### 1. Start the Gateway Stack

Run this command to build and launch the Gateway container stack:

```bash
docker compose up -d --build
```

This starts:
* **Gateway Container:** `http://localhost:8080` (MCP Proxy & Control Plane)
* **Prometheus Metrics:** `http://localhost:9090/metrics`
* **PostgreSQL 16:** `localhost:5433` (DB: `agp`, User: `agp`, Pass: `agp`)
* **Redis 7.2:** `localhost:6379` (Killswitch & Spend Caps)

---

### 2. Control Plane API Examples (`curl`)

```bash
# 1. Mint a JWT Token
curl -X POST "http://localhost:8080/v1/token?agent_id=pay-agent-01&agent_kind=payments"

# 2. Revoke an agent instantly (<1ms)
curl -X POST "http://localhost:8080/v1/agents/pay-agent-01/revoke"

# 3. Revive the agent
curl -X DELETE "http://localhost:8080/v1/agents/pay-agent-01/revoke"

# 4. Trigger Fleet-Wide Emergency Stop (Panic Button)
curl -X POST "http://localhost:8080/v1/fleet/halt"

# 5. Resume Fleet Operations
curl -X DELETE "http://localhost:8080/v1/fleet/halt"

# 6. Verify Audit Ledger Cryptographic Integrity
curl "http://localhost:8080/v1/audit/verify"

# 7. View Agent Profiles
curl "http://localhost:8080/v1/profiles"
```

---

## 📂 Project Structure

```
gateway/
├── cmd/                        <-- Entry points & CLI test runners
│   ├── gateway/main.go         <-- Main Gateway Server
│   ├── test-all/main.go        <-- 8-feature automated verification suite
│   ├── test-anthos/main.go     <-- Downstream MCP test client
│   └── test-custom/main.go     <-- Agent Profile & Schema Filter test client
│
├── db/                         <-- Standard Database Root Directory
│   ├── migrations/             <-- Goose versioned SQL migrations (001_init.sql)
│   └── queries/                <-- SQL query definitions for sqlc
│
├── internal/                   <-- Core application packages
│   ├── agent/store.go          <-- Agent Profile/Instance Store (Redis <-> Postgres)
│   ├── audit/                  <-- SHA-256 Hash-chained audit logger & verifier
│   ├── authn/jwt.go            <-- JWT Token authentication manager
│   ├── authz/engine.go         <-- Embedded OPA Rego policy engine
│   ├── config/config.go        <-- Target routing & config parser
│   ├── db/                     <-- sqlc auto-generated Go query package
│   ├── killswitch/switch.go    <-- Redis sub-ms Killswitch & Fleet Halt
│   ├── metrics/metrics.go      <-- Prometheus metrics collector
│   ├── proxy/mcp_proxy.go      <-- Multi-target MCP security proxy & schema filter
│   └── spend/limiter.go        <-- Atomic Redis Lua spend limiter
│
├── policies/                   <-- OPA Rego policy rules
│   └── default.rego
│
├── docker-compose.yml          <-- Multi-container Docker orchestration
├── Dockerfile                  <-- Multi-stage Docker build file
└── sqlc.yaml                   <-- sqlc generator configuration
```
