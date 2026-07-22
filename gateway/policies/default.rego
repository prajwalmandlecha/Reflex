// Default Rego policy for the Agent Governance Platform.
// Implements default-deny with per-agent-kind allow rules.

package agp.authz

import rego.v1

# Default deny — every action must be explicitly allowed.
default allow := false

# Build the decision object returned to the gateway.
# If allow is true, reason will be the matching rule's justification.
# If allow is false, reason will explain why.

# --- Conversational Agent: read-only ---
allow if {
	input.agent_kind == "conversational"
	input.action in {"account.balance", "account.transactions", "account.details"}
}

reason := "conversational agent: read-only action allowed" if {
	input.agent_kind == "conversational"
	input.action in {"account.balance", "account.transactions", "account.details"}
}

# --- Payments Agent: can read + initiate payments ---
allow if {
	input.agent_kind == "payments"
	input.action in {"account.balance", "account.transactions", "payment.initiate", "payment.status"}
}

reason := "payments agent: action allowed" if {
	input.agent_kind == "payments"
	input.action in {"account.balance", "account.transactions", "payment.initiate", "payment.status"}
}

# --- Trading Agent: can read + quote + execute trades ---
allow if {
	input.agent_kind == "trading"
	input.action in {"account.balance", "trading.quote", "trading.execute", "trading.positions"}
}

reason := "trading agent: action allowed" if {
	input.agent_kind == "trading"
	input.action in {"account.balance", "trading.quote", "trading.execute", "trading.positions"}
}

# --- Catch-all deny reason ---
reason := sprintf("agent kind '%s' is not allowed to perform action '%s'", [input.agent_kind, input.action]) if {
	not allow
}
