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
	not (object.get(input, "resource", "") in {"prompt", "resource"})
}

reason := sprintf("action '%s' is not permitted by agent profile whitelist", [input.action]) if {
	count(input.allowed_tools) > 0
	not (input.action in input.allowed_tools)
	not (object.get(input, "resource", "") in {"prompt", "resource"})
	not deny
}

reason := sprintf("action '%s' is not permitted (no allowed tools configured in agent profile)", [input.action]) if {
	count(input.allowed_tools) == 0
	not (object.get(input, "resource", "") in {"prompt", "resource"})
	not deny
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

# NOTE: The per-agent tool whitelist (input.allowed_tools) is the single source
# of truth for which tools an agent may call. It is enforced here (Rule 1) and
# used to filter tools/list in Go. The hardcoded agent-kind allowlists that
# previously lived here (Rules 2-6) were removed: they were dead code in
# production because the JWT agent_kind (a class_id like "payment_concierge_bot")
# never matched the policy kinds ("payments", "conversational", ...), and they
# created a second, parallel authorization path that could disagree with the
# whitelist. If an agent has no whitelist, it is denied by default (default
# deny) — there is no implicit per-kind fallback anymore.

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
