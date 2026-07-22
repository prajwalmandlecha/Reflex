package agp.authz

import rego.v1

default allow := false

# Rule 1: Explicit Per-Agent Allowed Tools Whitelist (Profile / ABAC)
allow if {
	count(input.allowed_tools) > 0
	input.action in input.allowed_tools
}

reason := sprintf("action '%s' allowed by agent profile whitelist", [input.action]) if {
	count(input.allowed_tools) > 0
	input.action in input.allowed_tools
}

reason := sprintf("action '%s' is not permitted by agent profile whitelist", [input.action]) if {
	count(input.allowed_tools) > 0
	not (input.action in input.allowed_tools)
}

# Rule 2: Conversational Agent (Identity + Read-Only Insights)
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind == "conversational"
	input.action in {
		"login",
		"get_user_profile",
		"search_contacts",
		"get_contacts",
		"get_transaction_history",
		"get_transaction_count",
		"get_balance",
		"get_spending_summary",
		"get_budgets"
	}
}

# Rule 3: Payments Agent (Identity + Read + Transfers & Budgets)
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind == "payments"
	input.action in {
		"login",
		"get_user_profile",
		"search_contacts",
		"add_contact",
		"get_contacts",
		"transfer_money",
		"deposit_funds",
		"get_transaction_history",
		"get_transaction_count",
		"get_balance",
		"create_budget",
		"get_budgets",
		"update_budget",
		"delete_budget"
	}
}

# Rule 4: Securities / Trading Agent (Transfers & Trading)
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind == "trading"
	input.action in {
		"login",
		"get_user_profile",
		"transfer_money",
		"get_balance",
		"get_transaction_history",
		"get_transaction_count"
	}
}

# Rule 5: Risk & Security Ops Agent (Fraud & Anomaly Review)
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind == "ops"
	input.action in {
		"login",
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
}
