-- name: ListActivePolicies :many
SELECT
    rego_source,
    version
FROM
    policies
WHERE
    status = 'active'
ORDER BY
    id ASC;

-- name: GetActivePolicyFingerprint :one
-- Cheap fingerprint of the active policy set. Returns the count and max
-- version across active policies. Used by the poller to skip recompiling when
-- nothing changed. Count is included so that deleting a non-max-version policy
-- (which leaves MAX(version) unchanged) is still detected.
SELECT
    COUNT(*)::bigint AS policy_count,
    COALESCE(MAX(version), 0)::bigint AS max_version
FROM
    policies
WHERE
    status = 'active';