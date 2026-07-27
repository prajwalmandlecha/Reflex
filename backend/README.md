# Reflex Control Plane API Backend

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.12-blue.svg)](https://python.org)
[![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0-red.svg)](https://sqlalchemy.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7.2-red.svg)](https://redis.io)

The **Control Plane API** is the management and orchestration engine of the Reflex platform. Built with Python 3.12 and FastAPI, it handles policy compilation, agent lifecycle administration, dynamic configuration propagation to Redis, OpenAPI schema virtualization, and real-time WebSocket telemetry broadcasting.

---

## 🏛️ Architecture & Core Responsibilities

```
┌──────────────────────────────────────────────────────────────┐
│                  Control Center UI (:3000)                   │
└──────────────────────────────┬───────────────────────────────┘
                               │ REST / WebSocket
                               ▼
┌──────────────────────────────────────────────────────────────┐
│               CONTROL PLANE BACKEND API (:8000)              │
│                                                              │
│  ├── Policy Compiler Service (Rego Code Generator)           │
│  ├── Agent Class & Instance Manager                          │
│  ├── OpenAPI Virtualizer Service                             │
│  ├── Redis Cache Propagator & Pub/Sub Event Subscriber       │
│  └── WebSocket Manager (Telemetry Broadcast Hub)             │
└──────────────┬──────────────────────────────┬────────────────┘
               │                              │
               ▼                              ▼
 ┌──────────────────────────┐   ┌──────────────────────────┐
 │ PostgreSQL 16 Database   │   │ Redis 7.2 Cache & Pub/Sub│
 │ (Persistence & Audit)    │   │ (Gateway Hot-State Keys) │
 └──────────────────────────┘   └──────────────────────────┘
```

---

## 📂 Project Structure

```
backend/
├── Dockerfile                  <-- Container definition for FastAPI backend
├── requirements.txt            <-- Python dependencies (FastAPI, asyncpg, redis, etc.)
└── app/
    ├── main.py                 <-- Lifespan manager, CORS, and app startup initialization
    ├── config.py               <-- Pydantic environment configuration settings
    ├── database.py             <-- asyncpg PostgreSQL connection pool manager
    ├── redis_client.py         <-- redis-py async connection manager
    ├── crypto.py               <-- Cryptographic helper functions (SHA-256 hash chains)
    ├── event_processor.py      <-- Redis Pub/Sub listener routing events to WebSockets
    ├── ws_manager.py           <-- WebSocket client connections and broadcasting hub
    │
    ├── models/                 <-- Database models & Pydantic schemas
    ├── routes/                 <-- FastAPI route modules:
    │   ├── agent_classes.py    <-- Agent profile definitions & allowed tool sets
    │   ├── agent_instances.py  <-- Deployed bot instances & token assignments
    │   ├── audit.py            <-- Cryptographic audit log query & integrity verifier
    │   ├── bank_connections.py <-- Downstream bank MCP connection management
    │   ├── dashboard.py        <-- Telemetry summaries & latency distribution counters
    │   ├── fleet.py            <-- Panic button / emergency fleet halt controls
    │   ├── internal.py         <-- Internal gateway sync & health checks
    │   ├── metrics.py          <-- Prometheus metrics exporter endpoint
    │   ├── policies.py         <-- Policy definition CRUD & Rego compilation
    │   ├── tokens.py           <-- JWT bearer token generation for agents
    │   ├── tools.py            <-- Discovered tools & schema registry
    │   └── websockets.py       <-- WebSocket connection handler (`/ws/telemetry`)
    │
    └── services/               <-- Business logic & background services:
        ├── config_propagation.py <-- Flushes & updates active policies in Redis
        ├── mcp_discovery.py    <-- Fetches downstream MCP server tool definitions
        ├── openapi_ingestion.py  <-- Virtualizes OpenAPI specs into MCP tool schemas
        └── policy_engine.py    <-- Translates governance rules into Rego policies
```

---

## ⚙️ Configuration & Environment Variables

| Variable | Default Value | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://agp:agp@postgres:5432/agp` | Async SQLAlchemy PostgreSQL connection string |
| `PG_DSN` | `postgres://agp:agp@postgres:5432/agp?sslmode=disable` | Raw DSN for direct database queries |
| `REDIS_URL` | `redis://redis:6379/0` | Redis connection URL |
| `JWT_SECRET` | `jwt-secret` | HMAC secret for minting agent access tokens |
| `JWT_ISSUER` | `agp-gateway` | Expected JWT issuer claim |
| `GATEWAY_URL` | `http://gateway:8080` | Address of the Reflex Gateway Proxy |
| `CORS_ORIGINS` | `*` | Allowed CORS origins for browser dashboard |

---

## 🛠️ Local Development & Setup

### 1. Install Dependencies
```bash
cd backend
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Run Standalone Development Server
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 📡 Key API Routes

- `GET /health` — Service health check.
- `GET /api/v1/dashboard/summary` — Fleet overview, decision counters, and active alerts.
- `GET /api/v1/policies` — List configured governance policies.
- `POST /api/v1/policies` — Create policy and compile Rego rules into Redis cache.
- `GET /api/v1/audit/logs` — Query tamper-evident audit ledger entries.
- `GET /api/v1/audit/verify` — Validate SHA-256 hash-chain continuity.
- `WS /ws/telemetry` — Real-time WebSocket event stream for live dashboard telemetry.
