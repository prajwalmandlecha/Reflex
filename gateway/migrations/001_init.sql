-- Agent Governance Platform (AGP) - Initial Database Schema

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    agent_id VARCHAR(64) NOT NULL,
    action VARCHAR(128) NOT NULL,
    resource VARCHAR(256) NOT NULL DEFAULT '',
    decision VARCHAR(16) NOT NULL,
    spend_delta BIGINT NOT NULL DEFAULT 0,
    latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    reason TEXT NOT NULL DEFAULT '',
    prev_hash VARCHAR(64) NOT NULL DEFAULT '',
    entry_hash VARCHAR(64) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_agent_id ON audit_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);

CREATE TABLE IF NOT EXISTS policies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) UNIQUE NOT NULL,
    version INT NOT NULL DEFAULT 1,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent Profiles (Blueprints / Templates)
CREATE TABLE IF NOT EXISTS agent_profiles (
    profile_id VARCHAR(64) PRIMARY KEY,
    profile_name VARCHAR(128) NOT NULL,
    description TEXT,
    allowed_tools TEXT[] NOT NULL DEFAULT '{}',
    hourly_spend_cap_cents BIGINT DEFAULT 500000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent Instances (Deployed Bots)
CREATE TABLE IF NOT EXISTS agent_instances (
    agent_id VARCHAR(64) PRIMARY KEY,
    profile_id VARCHAR(64) REFERENCES agent_profiles(profile_id),
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Default Policy
INSERT INTO policies (name, version, source) VALUES ('default', 1, '
package agp.authz

import rego.v1

default allow := false

# Rule 1: Explicit Per-Agent Allowed Tools Whitelist (Profile / ABAC)
allow if {
    count(input.allowed_tools) > 0
    input.action in input.allowed_tools
}

reason := sprintf("action ''%s'' allowed by agent profile whitelist", [input.action]) if {
    count(input.allowed_tools) > 0
    input.action in input.allowed_tools
}

reason := sprintf("action ''%s'' is not permitted by agent profile whitelist", [input.action]) if {
    count(input.allowed_tools) > 0
    not (input.action in input.allowed_tools)
}

# Rule 2: Default Kind-Based RBAC Fallback (when allowed_tools is empty)
allow if {
    count(input.allowed_tools) == 0
    input.agent_kind == "conversational"
    input.action in {"login", "get_user_profile", "search_contacts", "get_contacts", "get_transaction_history", "get_balance", "get_spending_summary", "get_budgets"}
}

allow if {
    count(input.allowed_tools) == 0
    input.agent_kind == "payments"
    input.action in {"login", "get_user_profile", "search_contacts", "add_contact", "get_contacts", "transfer_money", "deposit_check", "get_transaction_history", "get_balance", "create_budget", "get_budgets", "update_budget", "delete_budget"}
}

allow if {
    count(input.allowed_tools) == 0
    input.agent_kind == "trading"
    input.action in {"login", "get_user_profile", "trading.execute", "get_balance", "get_transaction_history"}
}

allow if {
    count(input.allowed_tools) == 0
    input.agent_kind == "ops"
    input.action in {"login", "evaluate_transaction_risk", "get_flagged_anomalies", "confirm_pending_transaction", "cancel_pending_transaction"}
}

reason := sprintf("agent kind ''%s'' not allowed to perform action ''%s''", [input.agent_kind, input.action]) if {
    count(input.allowed_tools) == 0
    not allow
}
') ON CONFLICT (name) DO UPDATE SET source = EXCLUDED.source;

-- Seed Default Profiles
INSERT INTO agent_profiles (profile_id, profile_name, description, allowed_tools, hourly_spend_cap_cents) VALUES
('conversational', 'Conversational Read-Only Profile', 'Read-only profile for chat assistants', ARRAY['login', 'get_user_profile', 'search_contacts', 'get_contacts', 'get_transaction_history', 'get_balance', 'get_spending_summary', 'get_budgets'], 0),
('payments', 'Standard Payments Profile', 'Profile for wire transfer and payment bots', ARRAY['login', 'get_user_profile', 'search_contacts', 'add_contact', 'get_contacts', 'transfer_money', 'deposit_check', 'get_transaction_history', 'get_balance', 'create_budget', 'get_budgets', 'update_budget', 'delete_budget'], 500000),
('trading', 'Securities Trading Profile', 'Profile for automated stock trading bots', ARRAY['login', 'get_user_profile', 'trading.execute', 'get_balance', 'get_transaction_history'], 5000000),
('ops', 'Security Risk Ops Profile', 'Profile for fraud evaluation and risk management', ARRAY['login', 'evaluate_transaction_risk', 'get_flagged_anomalies', 'confirm_pending_transaction', 'cancel_pending_transaction'], 0),
('custom_alpha', 'Restricted Custom Alpha Profile', 'Custom profile allowing only balance checks and wire transfers', ARRAY['login', 'get_balance', 'transfer_money'], 100000)
ON CONFLICT (profile_id) DO NOTHING;

-- Seed Default Instances
INSERT INTO agent_instances (agent_id, profile_id, status) VALUES
('conv-agent-01', 'conversational', 'active'),
('pay-agent-01', 'payments', 'active'),
('trade-agent-01', 'trading', 'active'),
('risk-agent-01', 'ops', 'active'),
('custom-agent-alpha', 'custom_alpha', 'active')
ON CONFLICT (agent_id) DO NOTHING;
