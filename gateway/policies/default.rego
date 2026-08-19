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

# Rule 1b: Prompts & Resources are governed by their own `exposed` flag, not the
# tool whitelist. The gateway only routes prompts/resources that are exposed
# (they are absent from the routing map otherwise), so reaching OPA means they
# are already authorized to be read. The tool whitelist governs tools/call only.
allow if {
	input.resource in {"prompt", "resource"}
	not deny
}

reason := sprintf("prompt/resource '%s' allowed (exposed flag governs read access)", [input.action]) if {
	input.resource in {"prompt", "resource"}
	not deny
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

# Rule 6: Restricted Custom Alpha Agent (Read balance + limited transfers)
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind == "custom_alpha"
	input.action in {
		"login",
		"create_user",
		"get_balance",
		"transfer_money"
	}
}

# Catch-all deny reason if no rule matched
reason := sprintf("agent kind '%s' is not allowed to perform action '%s'", [input.agent_kind, input.action]) if {
	count(input.allowed_tools) == 0
	not allow
	not deny
}

# Rule 7: Execution Time Window (business hours) — enforced in Rego.
# The tool's effective constraints are passed into the policy input as
# input.constraints (see governance.go). If a tool declares a time_window
# {start, end} in HH:MM UTC, calls outside that window are denied. Handles
# overnight windows (start > end, e.g. 22:00–06:00) by wrapping past midnight.
deny if {
	tw := input.constraints.time_window
	tw.start != ""
	tw.end != ""
	not within_window(tw.start, tw.end)
}

reason := sprintf("action '%s' is restricted outside business hours (%s to %s UTC)", [input.action, input.constraints.time_window.start, input.constraints.time_window.end]) if {
	tw := input.constraints.time_window
	tw.start != ""
	tw.end != ""
	not within_window(tw.start, tw.end)
}

# within_window reports whether the current UTC time falls inside [start, end].
# Overnight windows (start > end) wrap past midnight: inside means >= start OR
# <= end.
within_window(start, end) if {
	start <= end
	now_minutes >= start_minutes(start)
	now_minutes <= start_minutes(end)
}

within_window(start, end) if {
	start > end
	now_minutes >= start_minutes(start)
}

within_window(start, end) if {
	start > end
	now_minutes <= start_minutes(end)
}

now_minutes := (clock[0] * 60) + clock[1] if {
	clock := time.clock(time.now_ns())
}

start_minutes(hhmm) := (h * 60) + m if {
	parts := split(hhmm, ":")
	h := to_number(parts[0])
	m := to_number(parts[1])
}
