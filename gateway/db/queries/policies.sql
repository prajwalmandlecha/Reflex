-- name: GetPolicyByName :one
SELECT id, name, version, source, created_at, updated_at
FROM policies
WHERE name = $1;

-- name: UpsertPolicy :exec
INSERT INTO policies (name, version, source, updated_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (name) DO UPDATE SET
    version = EXCLUDED.version,
    source = EXCLUDED.source,
    updated_at = NOW();
