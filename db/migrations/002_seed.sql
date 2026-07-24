-- +goose Up
-- Seed data for Agent Governance Platform

-- ============================================================
-- Default Rego Policy (global scope)
-- ============================================================
INSERT INTO policies (name, scope, target_id, type, version, rego_source, status) VALUES
('default', 'global', NULL, 'rego', 1, '
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
		"login", "create_user", "list_contacts", "resolve_contact",
		"get_balance", "get_transaction_history", "get_transaction_count",
		"get_spending_summary", "get_budget_overview", "get_savings_tips", "get_budgets"
	}
}

# Rule 3: Payments Agent
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind == "payments"
	input.action in {
		"login", "create_user", "list_contacts", "resolve_contact",
		"add_contact", "update_contact", "delete_contact",
		"get_balance", "get_transaction_history", "get_transaction_count",
		"transfer_money", "deposit_funds",
		"get_spending_summary", "get_budget_overview",
		"create_budget", "get_budgets", "update_budget", "delete_budget"
	}
}

# Rule 4: Trading Agent
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind == "trading"
	input.action in {
		"login", "create_user", "get_balance",
		"get_transaction_history", "get_transaction_count", "transfer_money"
	}
}

# Rule 5: Risk & Ops Agent
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind in {"ops", "admin"}
	input.action in {
		"login", "create_user", "evaluate_transaction_risk",
		"get_flagged_anomalies", "confirm_pending_transaction", "cancel_pending_transaction"
	}
}

# Catch-all deny reason
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
}
', 'active')
ON CONFLICT (name) DO UPDATE SET rego_source = EXCLUDED.rego_source, version = policies.version + 1;

-- ============================================================
-- Agent Classes
-- ============================================================
INSERT INTO agent_classes (id, name, description, default_allowed_tools, default_constraints, default_caps, status) VALUES
(
    'conversational',
    'Conversational Read-Only',
    'Read-only profile for chat assistants — can query balances, transactions, and budgets but cannot move money.',
    ARRAY['login','create_user','list_contacts','resolve_contact','get_balance','get_transaction_history','get_transaction_count','get_spending_summary','get_budget_overview','get_savings_tips','get_budgets'],
    '{"get_balance": {"rate_limit": {"max_calls": 60, "window_seconds": 3600}}, "get_transaction_history": {"rate_limit": {"max_calls": 30, "window_seconds": 3600}}}'::jsonb,
    '{"hourly": {"amount_cents": 0, "count": 200}, "daily": {"amount_cents": 0, "count": 2000}}'::jsonb,
    'active'
),
(
    'payments',
    'Standard Payments',
    'Profile for wire transfer and payment bots — can initiate transfers with spend caps.',
    ARRAY['login','create_user','list_contacts','resolve_contact','add_contact','update_contact','delete_contact','get_balance','get_transaction_history','get_transaction_count','transfer_money','deposit_funds','get_spending_summary','get_budget_overview','create_budget','get_budgets','update_budget','delete_budget'],
    '{"transfer_money": {"max_amount": 1000.00, "max_daily_count": 20, "allowed_currencies": ["USD","EUR"]}, "deposit_funds": {"max_amount": 5000.00}}'::jsonb,
    '{"hourly": {"amount_cents": 500000, "count": 50}, "daily": {"amount_cents": 5000000, "count": 500}, "per_transaction": {"max_amount_cents": 100000}}'::jsonb,
    'active'
),
(
    'trading',
    'Securities Trading',
    'Profile for automated stock trading bots — can execute transfers with high caps.',
    ARRAY['login','create_user','get_balance','get_transaction_history','get_transaction_count','transfer_money'],
    '{"transfer_money": {"max_amount": 5000.00, "max_daily_count": 100}}'::jsonb,
    '{"hourly": {"amount_cents": 5000000, "count": 200}, "daily": {"amount_cents": 50000000, "count": 2000}, "per_transaction": {"max_amount_cents": 500000}}'::jsonb,
    'active'
),
(
    'ops',
    'Security Risk Ops',
    'Profile for fraud evaluation and risk management — read-heavy with no spending.',
    ARRAY['login','create_user','evaluate_transaction_risk','get_flagged_anomalies','confirm_pending_transaction','cancel_pending_transaction'],
    '{"evaluate_transaction_risk": {"rate_limit": {"max_calls": 200, "window_seconds": 3600}}}'::jsonb,
    '{"hourly": {"amount_cents": 0, "count": 500}, "daily": {"amount_cents": 0, "count": 5000}}'::jsonb,
    'active'
),
(
    'custom_alpha',
    'Restricted Custom Alpha',
    'Custom profile allowing only balance checks and wire transfers with tight constraints.',
    ARRAY['login','create_user','get_balance','transfer_money'],
    '{"transfer_money": {"max_amount": 500.00, "max_daily_count": 5, "time_window": {"start": "09:00", "end": "17:00", "tz": "UTC"}}}'::jsonb,
    '{"hourly": {"amount_cents": 100000, "count": 10}, "daily": {"amount_cents": 500000, "count": 50}, "per_transaction": {"max_amount_cents": 50000}}'::jsonb,
    'active'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Agent Instances
-- ============================================================
INSERT INTO agent_instances (id, class_id, status, constraint_overrides, cap_overrides) VALUES
('conv-agent-01', 'conversational', 'active', '{}', '{}'),
('pay-agent-01', 'payments', 'active', '{}', '{}'),
('trade-agent-01', 'trading', 'active', '{}', '{}'),
('risk-agent-01', 'ops', 'active', '{}', '{}'),
('custom-agent-alpha', 'custom_alpha', 'active',
    '{"transfer_money": {"max_amount": 250.00}}'::jsonb,
    '{"hourly": {"amount_cents": 50000, "count": 5}}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Bank Connections
-- ============================================================
INSERT INTO bank_connections (id, name, source_type, mcp_url, status) VALUES
('bank-identity', 'Bank of Anthos — Identity Service', 'native_mcp', 'http://20.2.83.126:31100/mcp', 'connected'),
('bank-payments', 'Bank of Anthos — Payments Service', 'native_mcp', 'http://20.2.83.126:31200/mcp', 'connected'),
('bank-financial', 'Bank of Anthos — Financial Service', 'native_mcp', 'http://20.2.83.126:31300/mcp', 'connected'),
('bank-risk', 'Bank of Anthos — Risk Service', 'native_mcp', 'http://20.2.83.126:31400/mcp', 'connected')
ON CONFLICT (id) DO NOTHING;
