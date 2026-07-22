# Reflex — Governance Layer for Financial AI Agents

[![Go Version](https://img.shields.io/badge/Go-1.26-blue.svg)](https://golang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7.2-red.svg)](https://redis.io)
[![OPA](https://img.shields.io/badge/OPA-v1.0-blueviolet.svg)](https://openpolicyagent.org)
[![Goose](https://img.shields.io/badge/Goose-v3.27-brightgreen.svg)](https://pressly.github.io/goose)
[![sqlc](https://img.shields.io/badge/sqlc-v1.31-orange.svg)](https://sqlc.dev)

Reflex is an enterprise-grade **In-Flight Security Interceptor & Transparent Reverse Proxy** for autonomous AI agents operating in financial services. It provides the safety infrastructure allowing banks to deploy fleets of agents responsibly—covering granular per-agent permission profiles, dynamic spend caps, sub-millisecond revocation controls, cryptographic SHA-256 audit logs, and an emergency stop that can halt an entire fleet instantly.

---

## 📂 Repositories & Modules

* 🚀 **[AGP Gateway Documentation (`gateway/README.md`)](./gateway/README.md)**  
  The core Go-based MCP transparent security reverse proxy, embedded Open Policy Agent (OPA) engine, sub-millisecond Redis killswitch, atomic spend caps, Goose migrations, type-safe `sqlc` database layer, and complete REST/MCP API specifications.

---

## 🏛️ System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  AI AGENTS (VS Code Copilot, Claude Desktop, CrewAI, etc.)  │
└──────────────────────────────┬──────────────────────────────┘
                               │ MCP JSON-RPC over HTTP
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  REFLEX GATEWAY (:8080)                                     │
│                                                             │
│  1. Identify Agent (JWT / Headers)                          │
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

## ⚡ Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/prajwalmandlecha/Reflex.git
cd Reflex/gateway

# 2. Launch the Gateway Docker stack
docker compose up -d --build

# 3. Run the automated 8-feature verification suite
./test-all.sh
```

For complete API documentation, control plane endpoints, and testing guides, visit the **[Gateway README](./gateway/README.md)**.
