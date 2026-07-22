# AGP Gateway

Stateless Go gateway for the Agent Governance Platform. Sits between bank agents (MCP clients) and bank services, enforcing authorization on every action.

## Architecture

```
Agent (MCP client)
  → Gateway (MCP server + OPA + Redis + Postgres)
    → Bank Service (MCP server, stubbed for demo)
```

**Hot path per request:** JWT auth → Kill switch (Redis) → OPA policy (in-process) → Spend cap (Redis Lua) → Relay → Audit log (async)

## Quick Start

```bash
# Start everything (Postgres, Redis, Gateway)
docker compose up --build

# Or run locally (requires Redis + Postgres running)
export REDIS_ADDR=localhost:6379
export POSTGRES_DSN="postgres://agp:agp@localhost:5432/agp?sslmode=disable"
go run ./cmd/gateway
```

## API Endpoints

### Agent-facing (MCP)
- `POST /mcp` — MCP Streamable HTTP endpoint (agents connect here)

### Control plane (REST)
- `POST /v1/token?agent_id=X` — Mint a JWT for an agent (demo convenience)
- `POST /v1/agents/{id}/revoke` — Revoke an agent (set kill switch)
- `DELETE /v1/agents/{id}/revoke` — Revive a revoked agent
- `POST /v1/fleet/halt` — Emergency fleet-wide halt
- `DELETE /v1/fleet/halt` — Resume fleet
- `GET /v1/audit/verify` — Verify audit log hash-chain integrity
- `GET /health` — Health check

### Metrics
- `GET :9090/metrics` — Prometheus metrics

## Demo Agents

| Agent ID | Kind | Allowed Actions | Spend Cap |
|---|---|---|---|
| `conv-agent-01` | conversational | `account.balance`, `account.transactions`, `account.details` | None |
| `pay-agent-01` | payments | `account.balance`, `account.transactions`, `payment.initiate`, `payment.status` | $5,000/hour |
| `trade-agent-01` | trading | `account.balance`, `trading.quote`, `trading.execute`, `trading.positions` | $50,000/day |

## Testing

```bash
# Get a token for an agent
curl -X POST "http://localhost:8080/v1/token?agent_id=pay-agent-01"

# Revoke an agent
curl -X POST http://localhost:8080/v1/agents/pay-agent-01/revoke

# Halt the fleet
curl -X POST http://localhost:8080/v1/fleet/halt

# Resume the fleet  
curl -X DELETE http://localhost:8080/v1/fleet/halt

# Verify audit integrity
curl http://localhost:8080/v1/audit/verify
```

## Project Structure

```
gateway/
├── cmd/gateway/main.go           # Entrypoint: wiring, config, shutdown
├── internal/
│   ├── config/config.go          # Env-based configuration
│   ├── authn/jwt.go              # JWT minting + validation
│   ├── authz/engine.go           # OPA engine with atomic hot-reload
│   ├── spend/limiter.go          # Atomic Redis spend-cap (Lua script)
│   ├── killswitch/switch.go      # Redis kill-switch checks
│   ├── session/store.go          # Redis-backed MCP sessions
│   ├── audit/
│   │   ├── logger.go             # Hash-chained audit writer (batched)
│   │   └── verifier.go           # Chain integrity checker
│   ├── gateway/
│   │   ├── handler.go            # Core authorization pipeline
│   │   ├── mcpserver.go          # Inbound MCP server
│   │   └── mcpclient.go          # Outbound MCP client (stub)
│   └── metrics/metrics.go        # Prometheus metrics
├── policies/default.rego          # Seed Rego policies
├── migrations/001_init.sql        # Postgres schema + seed data
├── docker-compose.yml
└── Dockerfile
```
