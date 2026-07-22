// Default Rego policy for the Agent Governance Platform.
// Implements default-deny with per-agent-kind allow rules for Bank of Anthos MCP tools.

package agp.authz

import rego.v1

# Default deny — every action must be explicitly allowed.
default allow := false

# --- Conversational Agent: read-only & identity ---
allow if {
	input.agent_kind == "conversational"
	input.action in {
		"login",
		"get_user_profile",
		"search_contacts",
		"get_contacts",
		"get_transaction_history",
		"get_account_details",
		"get_spending_insights",
		"get_budgets"
	}
}

reason := "conversational agent: read-only and identity actions allowed" if {
	input.agent_kind == "conversational"
	input.action in {
		"login",
		"get_user_profile",
		"search_contacts",
		"get_contacts",
		"get_transaction_history",
		"get_account_details",
		"get_spending_insights",
		"get_budgets"
	}
}

# --- Payments Agent: identity + read + payment operations ---
allow if {
	input.agent_kind == "payments"
	input.action in {
		"login",
		"get_user_profile",
		"search_contacts",
		"add_contact",
		"get_contacts",
		"transfer_money",
		"deposit_check",
		"get_transaction_history",
		"get_account_details",
		"create_budget",
		"get_budgets",
		"update_budget",
		"delete_budget"
	}
}

reason := "payments agent: payment and account actions allowed" if {
	input.agent_kind == "payments"
	input.action in {
		"login",
		"get_user_profile",
		"search_contacts",
		"add_contact",
		"get_contacts",
		"transfer_money",
		"deposit_check",
		"get_transaction_history",
		"get_account_details",
		"create_budget",
		"get_budgets",
		"update_budget",
		"delete_budget"
	}
}

# --- Risk / Security Agent: risk evaluation & anomaly management ---
allow if {
	input.agent_kind == "ops"
	input.action in {
		"login",
		"evaluate_transaction_risk",
		"get_flagged_anomalies",
		"confirm_pending_transaction",
		"cancel_pending_transaction"
	}
}

reason := "risk/ops agent: security evaluation actions allowed" if {
	input.agent_kind == "ops"
	input.action in {
		"login",
		"evaluate_transaction_risk",
		"get_flagged_anomalies",
		"confirm_pending_transaction",
		"cancel_pending_transaction"
	}
}

# --- Catch-all deny reason ---
reason := sprintf("agent kind '%s' is not allowed to perform action '%s'", [input.agent_kind, input.action]) if {
	not allow
}
