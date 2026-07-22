-- name: InsertAuditLog :exec
INSERT INTO audit_log (
    ts, agent_id, action, resource, decision, spend_delta, latency_ms, reason, prev_hash, entry_hash
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
);

-- name: GetLastAuditLog :one
SELECT id, ts, agent_id, action, resource, decision, spend_delta, latency_ms, reason, prev_hash, entry_hash
FROM audit_log
ORDER BY id DESC
LIMIT 1;

-- name: ListAuditLogs :many
SELECT id, ts, agent_id, action, resource, decision, spend_delta, latency_ms, reason, prev_hash, entry_hash
FROM audit_log
ORDER BY id ASC;
