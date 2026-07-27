-- +goose Up
-- Seed data for Agent Governance Platform (Minimal Baseline Default Policy)

-- ============================================================
-- Default Rego Security Policy (global scope baseline)
-- ============================================================
INSERT INTO policies (name, scope, target_id, type, version, rego_source, status) VALUES
('default', 'global', NULL, 'rego', 1, '
package agp.authz

import rego.v1

default allow := false
default deny := false

# Rule 1: Explicit Per-Agent Allowed Tools Whitelist (ABAC)
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

# Catch-all deny reason
reason := sprintf("agent kind ''%s'' is not allowed to perform action ''%s''", [input.agent_kind, input.action]) if {
	count(input.allowed_tools) == 0
	not allow
	not deny
}
', 'active')
ON CONFLICT DO NOTHING;

-- +goose Down
TRUNCATE TABLE policies CASCADE;
