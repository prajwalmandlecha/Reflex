-- name: GetLastAuditEntryHash :one
SELECT
    entry_hash
FROM
    audit_log
ORDER BY
    id DESC
LIMIT
    1;

-- name: ListAuditLogForVerify :many
SELECT
    id,
    ts,
    agent_id,
    agent_class_id,
    action,
    decision,
    deny_stage,
    spend_delta,
    governance_overhead_ms,
    reason,
    prev_hash,
    entry_hash
FROM
    audit_log
ORDER BY
    id ASC;

-- name: InsertAuditEntry :exec
INSERT INTO
    audit_log (
        ts,
        agent_id,
        agent_class_id,
        action,
        bank_connection_id,
        params,
        decision,
        deny_stage,
        reason,
        spend_delta,
        total_latency_ms,
        killswitch_latency_ms,
        policy_latency_ms,
        spend_check_latency_ms,
        constraint_latency_ms,
        downstream_latency_ms,
        governance_overhead_ms,
        prev_hash,
        entry_hash
    )
VALUES
    (
        @ ts,
        @ agent_id,
        @ agent_class_id,
        @ action,
        @ bank_connection_id,
        @ params::jsonb,
        @ decision,
        @ deny_stage,
        @ reason,
        @ spend_delta,
        @ total_latency_ms,
        @ killswitch_latency_ms,
        @ policy_latency_ms,
        @ spend_check_latency_ms,
        @ constraint_latency_ms,
        @ downstream_latency_ms,
        @ governance_overhead_ms,
        @ prev_hash,
        @ entry_hash
    );