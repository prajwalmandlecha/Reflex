-- Agent Governance Platform — initial schema
-- This migration creates all tables needed by the gateway and control plane.

-- Agents registry
CREATE TABLE IF NOT EXISTS agents (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('conversational', 'payments', 'trading', 'ops')),
    framework   TEXT NOT NULL DEFAULT 'custom',
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Policies (Rego source, versioned per agent)
CREATE TABLE IF NOT EXISTS policies (
    id          SERIAL PRIMARY KEY,
    agent_id    TEXT REFERENCES agents(id),
    version     INT NOT NULL DEFAULT 1,
    engine      TEXT NOT NULL DEFAULT 'rego' CHECK (engine = 'rego'),
    source      TEXT NOT NULL,
    active_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active_to   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (agent_id, version)
);

-- Budget caps (hierarchical: agent, category, fleet, global)
CREATE TABLE IF NOT EXISTS budget_caps (
    id           SERIAL PRIMARY KEY,
    scope_type   TEXT NOT NULL CHECK (scope_type IN ('agent', 'category', 'fleet', 'global')),
    scope_id     TEXT NOT NULL,
    period       TEXT NOT NULL DEFAULT 'daily' CHECK (period IN ('hourly', 'daily', 'monthly')),
    limit_amount BIGINT NOT NULL, -- in smallest currency unit (cents)
    currency     TEXT NOT NULL DEFAULT 'USD',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Revocations (explicit operator revocations, separate from kill-switch flags)
CREATE TABLE IF NOT EXISTS revocations (
    id          SERIAL PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agents(id),
    revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_by  TEXT NOT NULL,
    reason      TEXT NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- Audit log (hash-chained, append-only)
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    agent_id    TEXT NOT NULL,
    action      TEXT NOT NULL,
    resource    TEXT NOT NULL DEFAULT '',
    decision    TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
    policy_id   INT,
    spend_delta BIGINT NOT NULL DEFAULT 0,
    latency_ms  DOUBLE PRECISION NOT NULL DEFAULT 0,
    reason      TEXT NOT NULL DEFAULT '',
    prev_hash   TEXT NOT NULL DEFAULT '',
    entry_hash  TEXT NOT NULL DEFAULT ''
);

-- Indexes for audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_agent_id ON audit_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_log(decision);
CREATE INDEX IF NOT EXISTS idx_audit_agent_ts ON audit_log(agent_id, ts);

-- Operators (dashboard users)
CREATE TABLE IF NOT EXISTS operators (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    email       TEXT NOT NULL UNIQUE,
    role        TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'responder', 'viewer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SEED DATA: 3 demo agents with distinct policies and budgets
-- ============================================================

-- Agents
INSERT INTO agents (id, name, kind, framework) VALUES
    ('conv-agent-01', 'Conversational Assistant', 'conversational', 'langchain'),
    ('pay-agent-01',  'Payments Agent',           'payments',       'crewai'),
    ('trade-agent-01','Trading Support Agent',     'trading',        'bedrock')
ON CONFLICT (id) DO NOTHING;

-- Global policy (applies to all agents — loaded by the OPA engine)
INSERT INTO policies (agent_id, version, source) VALUES
    (NULL, 1, '
package agp.authz

import rego.v1

default allow := false

# Conversational Agent: read-only
allow if {
    input.agent_kind == "conversational"
    input.action in {"account.balance", "account.transactions", "account.details"}
}
reason := "conversational agent: read-only action allowed" if {
    input.agent_kind == "conversational"
    input.action in {"account.balance", "account.transactions", "account.details"}
}

# Payments Agent: read + payment operations
allow if {
    input.agent_kind == "payments"
    input.action in {"account.balance", "account.transactions", "payment.initiate", "payment.status"}
}
reason := "payments agent: action allowed" if {
    input.agent_kind == "payments"
    input.action in {"account.balance", "account.transactions", "payment.initiate", "payment.status"}
}

# Trading Agent: read + trading operations
allow if {
    input.agent_kind == "trading"
    input.action in {"account.balance", "trading.quote", "trading.execute", "trading.positions"}
}
reason := "trading agent: action allowed" if {
    input.agent_kind == "trading"
    input.action in {"account.balance", "trading.quote", "trading.execute", "trading.positions"}
}

# Catch-all deny reason
reason := sprintf("agent kind ''%s'' not allowed to perform action ''%s''", [input.agent_kind, input.action]) if {
    not allow
}
')
ON CONFLICT DO NOTHING;

-- Budget caps
INSERT INTO budget_caps (scope_type, scope_id, period, limit_amount, currency) VALUES
    -- Per-agent caps
    ('agent', 'pay-agent-01',   'hourly',  500000,    'USD'),   -- $5,000/hour
    ('agent', 'trade-agent-01', 'daily',   5000000,   'USD'),   -- $50,000/day
    -- Fleet-wide cap
    ('fleet', 'all',            'daily',   50000000,  'USD'),   -- $500,000/day
    -- Global cap
    ('global', 'all',           'daily',   50000000,  'USD')    -- $500,000/day
ON CONFLICT DO NOTHING;

-- Default operator
INSERT INTO operators (id, email, role) VALUES
    ('op-admin-01', 'admin@agp.demo', 'admin')
ON CONFLICT (id) DO NOTHING;
