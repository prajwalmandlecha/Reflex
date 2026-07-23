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

reason := sprintf("action '%s' allowed by agent profile whitelist", [input.action]) if {
	count(input.allowed_tools) > 0
	input.action in input.allowed_tools
	not deny
}

reason := sprintf("action '%s' is not permitted by agent profile whitelist", [input.action]) if {
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
reason := sprintf("agent kind '%s' is not allowed to perform action '%s'", [input.agent_kind, input.action]) if {
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
