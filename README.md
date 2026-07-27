# Reflex — Governance Layer for Financial AI Agents

[![Go Version](https://img.shields.io/badge/Go-1.26-blue.svg)](https://golang.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)](https://fastapi.tiangolo.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7.2-red.svg)](https://redis.io)
[![OPA](https://img.shields.io/badge/OPA-v1.0-blueviolet.svg)](https://openpolicyagent.org)
[![License](https://img.shields.io/badge/License-Apache--2.0-green.svg)](LICENSE)

**Reflex** is an enterprise-grade **In-Flight Security Interceptor & Transparent Reverse Proxy** for autonomous AI agents operating in financial services and high-compliance enterprise environments.

It provides real-time governance infrastructure that empowers financial institutions to deploy fleets of autonomous AI agents safely—enforcing granular attribute-based tool permissions (ABAC), sub-millisecond killswitches, atomic dynamic spend limits, real-time rate limiting, embedded OPA policy evaluation, and tamper-evident SHA-256 cryptographic audit trails.

---

## 🏛️ System Architecture

Reflex sits transparently between **AI Agents** (VS Code Copilot, Claude Desktop, CrewAI, AutoGen, custom LLMs) and **Downstream MCP Servers** (Core Banking, Payment Rail API, Credit Risk Ops):

```
┌─────────────────────────────────────────────────────────────────────────┐
│              AI AGENT FLEET (Claude, AutoGen, CrewAI, etc.)             │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Model Context Protocol (MCP JSON-RPC)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         REFLEX GATEWAY (:8080)                          │
│                                                                         │
│  1. Authenticate & Bind Agent Context (JWT / Headers)                   │
│  2. Dynamic Discovery Tool Schema Filtering (`tools/list`)              │
│  3. In-Flight Governance Interception Pipeline (`tools/call`):          │
│     ├── Stage 1: Sub-ms Redis Killswitch & Fleet Panic Button           │
│     ├── Stage 2: Rate Limit & Business Hours Time-Window Checker        │
│     ├── Stage 3: Embedded OPA Rego Engine (Parameter & Schema Bounds)   │
│     ├── Stage 4: Atomic Redis Lua Spend Cap Enforcement                 │
│     └── Stage 5: Cryptographic SHA-256 Hash-Chained Audit Ledger        │
│                                                                         │
│  4. Transparent Forwarding to Target Downstream Bank MCP Services       │
└───────────────┬────────────────────┬────────────────────┬───────────────┘
                │                    │                    │
                ▼                    ▼                    ▼
     ┌────────────────────┐┌────────────────────┐┌────────────────────┐
     │  Bank Identity     ││  Bank Payments     ││  Bank Fraud/Risk   │
     │  MCP Server        ││  MCP Server        ││  MCP Server        │
     │  (:31100)          ││  (:31200)          ││  (:31400)          │
     └────────────────────┘└────────────────────┘└────────────────────┘
```

---

## 🌟 Key Capabilities

- 🛡️ **In-Flight Multi-Stage Governance Gauntlet**: Evaluates every tool execution attempt in real time through 5 safety stages before touching bank backend systems.
- ⚡ **Sub-Millisecond Killswitch & Fleet Halt**: Instantly revoke individual agent instances or halt the entire agent fleet in <1ms via pipeline-cached Redis keys.
- 🔍 **Dynamic Discovery Schema Filtering**: Automatically filters `tools/list` discovery output per agent profile to eliminate LLM hallucinations and unauthorized invocation attempts.
- 💰 **Atomic Spend Cap Engine**: Prevents race conditions and budget overruns using atomic Redis Lua scripts for hourly, daily, and per-transaction limits.
- 📜 **Embedded OPA Rego Policy Engine**: Lock-free, in-memory Open Policy Agent evaluation with atomic hot-reloading from PostgreSQL.
- 🔒 **Tamper-Evident SHA-256 Audit Ledger**: Cryptographically chained audit logs (`entry_hash = SHA-256(prev_hash || row_data)`) with web-dashboard verification.
- 📊 **Real-Time Instrumentation & Control Center**: Next.js 14 dark-mode management console with live WebSocket telemetry streams, visual condition builders, and latency percentiles (P50/P95/P99).

---

## 📂 Platform Architecture & Components

Reflex is organized into modular high-performance services:

| Component | Tech Stack | Description | Documentation |
|---|---|---|---|
| **Gateway Proxy** | Go 1.26, OPA, Redis, PostgreSQL, Goose, sqlc | Ultra-low latency transparent reverse proxy, MCP interceptor, embedded OPA engine, Redis spend limiter, and audit logger. | [Gateway Docs](./gateway/README.md) |
| **Control Plane API** | Python 3.12, FastAPI, Pydantic, SQLAlchemy | Policy compiler, visual rule generator, agent class/instance manager, and OpenAPI spec virtualizer. | [Backend Code](./backend/) |
| **Control Center** | Next.js 14, React 18, Tailwind CSS, Lucide Icons | Enterprise operator dashboard featuring fleet control, visual policy builder, telemetry, and cryptographic audit verifier. | [Frontend Code](./frontend/) |

---

## 🚀 Quick Start

### 1. Prerequisites
- **Docker** & **Docker Compose**
- **Go 1.26+** and **Python 3.12+** (optional for local standalone development)

### 2. Launch the Full Reflex Platform Stack
```bash
# Clone the repository
git clone https://github.com/prajwalmandlecha/Reflex.git
cd Reflex

# Build and start all services via Docker Compose
docker compose up -d --build
```

The stack exposes the following services:
- 🌐 **Reflex Control Center UI**: `http://localhost:3000`
- ⚡ **Reflex Gateway Proxy**: `http://localhost:8080`
- ⚙️ **Backend Control Plane API**: `http://localhost:8000`
- 📊 **Prometheus Exposition**: `http://localhost:9090/metrics`
- 🗄️ **PostgreSQL 16**: `localhost:5433`
- 🔑 **Redis 7.2 Cache**: `localhost:6379`

---

## 🧪 Testing & Verification

Reflex includes end-to-end automated verification suites for security, performance, and policy enforcement:

```bash
# Run real agent MCP tool call test suite ($500 DENIED, $1300 DENIED, $1100 ALLOWED)
python scripts/test_three_bounds.py

# Run policy validation & Rego compiler suite
python scripts/test_policy_validation.py

# Run Go Gateway multi-feature integration suite
cd gateway && go run ./cmd/test-all
```

---