-- +goose Up
-- SQL migration for Agent Governance Platform (AGP)

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

CREATE TABLE IF NOT EXISTS agent_profiles (
    profile_id VARCHAR(64) PRIMARY KEY,
    profile_name VARCHAR(128) NOT NULL,
    description TEXT,
    allowed_tools TEXT[] NOT NULL DEFAULT '{}',
    hourly_spend_cap_cents BIGINT DEFAULT 500000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
default deny := false

# Rule 1: Explicit Per-Agent Allowed Tools Whitelist (Profile / ABAC)
allow if {
	count(input.allowed_tools) > 0
	input.action in input.allowed_tools
	not deny
}

reason := sprintf("action ''%s'' allowed by agent profile whitelist", [input.action]) if {
	count(input.allowed_tools) > 0
	input.action in input.allowed_tools
	not deny
}

reason := sprintf("action ''%s'' is not permitted by agent profile whitelist", [input.action]) if {
	count(input.allowed_tools) > 0
	not (input.action in input.allowed_tools)
}

# Rule 2: Conversational Agent (Identity, User Onboarding & Read-Only Insights)
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind in {"conversational", "onboarding"}
	input.action in {
		"login",
		"create_user",
		"list_contacts",
		"resolve_contact",
		"get_balance",
		"get_transaction_history",
		"get_transaction_count",
		"get_spending_summary",
		"get_budget_overview",
		"get_savings_tips",
		"get_budgets"
	}
}

# Rule 3: Payments Agent (Identity, Transfers, Contacts & Budget Management)
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind == "payments"
	input.action in {
		"login",
		"create_user",
		"list_contacts",
		"resolve_contact",
		"add_contact",
		"update_contact",
		"delete_contact",
		"get_balance",
		"get_transaction_history",
		"get_transaction_count",
		"transfer_money",
		"deposit_funds",
		"get_spending_summary",
		"get_budget_overview",
		"create_budget",
		"get_budgets",
		"update_budget",
		"delete_budget"
	}
}

# Rule 4: Securities / Trading Agent (Transfers & Account Ledger)
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind == "trading"
	input.action in {
		"login",
		"create_user",
		"get_balance",
		"get_transaction_history",
		"get_transaction_count",
		"transfer_money"
	}
}

# Rule 5: Risk & Security Ops / Admin Agent (Fraud, Anomaly Review & User Management)
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind in {"ops", "admin"}
	input.action in {
		"login",
		"create_user",
		"evaluate_transaction_risk",
		"get_flagged_anomalies",
		"confirm_pending_transaction",
		"cancel_pending_transaction"
	}
}

# Catch-all deny reason if no rule matched
reason := sprintf("agent kind ''%s'' is not allowed to perform action ''%s''", [input.agent_kind, input.action]) if {
	count(input.allowed_tools) == 0
	not allow
	not deny
}

# Rule 6: Parameter Bounds Enforcement (Single-Transaction Transfer Cap of $1,000.00)
deny if {
	input.action == "transfer_money"
	input.amount > 1000.00
}

reason := sprintf("transfer amount $%.2f exceeds maximum allowed single-transaction parameter bound of $1000.00", [input.amount]) if {
	deny
}') ON CONFLICT (name) DO UPDATE SET source = EXCLUDED.source, version = policies.version + 1;

-- Seed Default Profiles
INSERT INTO agent_profiles (profile_id, profile_name, description, allowed_tools, hourly_spend_cap_cents) VALUES
('conversational', 'Conversational Read-Only Profile', 'Read-only profile for chat assistants', ARRAY['login', 'create_user', 'list_contacts', 'resolve_contact', 'get_balance', 'get_transaction_history', 'get_transaction_count', 'get_spending_summary', 'get_budget_overview', 'get_savings_tips', 'get_budgets'], 0),
('payments', 'Standard Payments Profile', 'Profile for wire transfer and payment bots', ARRAY['login', 'create_user', 'list_contacts', 'resolve_contact', 'add_contact', 'update_contact', 'delete_contact', 'get_balance', 'get_transaction_history', 'get_transaction_count', 'transfer_money', 'deposit_funds', 'get_spending_summary', 'get_budget_overview', 'create_budget', 'get_budgets', 'update_budget', 'delete_budget'], 500000),
('trading', 'Securities Trading Profile', 'Profile for automated stock trading bots', ARRAY['login', 'create_user', 'get_balance', 'get_transaction_history', 'get_transaction_count', 'transfer_money'], 5000000),
('ops', 'Security Risk Ops Profile', 'Profile for fraud evaluation and risk management', ARRAY['login', 'create_user', 'evaluate_transaction_risk', 'get_flagged_anomalies', 'confirm_pending_transaction', 'cancel_pending_transaction'], 0),
('custom_alpha', 'Restricted Custom Alpha Profile', 'Custom profile allowing only balance checks and wire transfers', ARRAY['login', 'create_user', 'get_balance', 'transfer_money'], 100000)
ON CONFLICT (profile_id) DO UPDATE SET allowed_tools = EXCLUDED.allowed_tools;

-- Seed Default Instances
INSERT INTO agent_instances (agent_id, profile_id, status) VALUES
('conv-agent-01', 'conversational', 'active'),
('pay-agent-01', 'payments', 'active'),
('trade-agent-01', 'trading', 'active'),
('risk-agent-01', 'ops', 'active'),
('custom-agent-alpha', 'custom_alpha', 'active')
ON CONFLICT (agent_id) DO NOTHING;
