-- name: GetAgentPermissions :one
SELECT i.status, COALESCE(p.allowed_tools, '{}')::text[] AS allowed_tools
FROM agent_instances i
LEFT JOIN agent_profiles p ON i.profile_id = p.profile_id
WHERE i.agent_id = $1;

-- name: UpsertAgentProfile :exec
INSERT INTO agent_profiles (profile_id, profile_name, description, allowed_tools, hourly_spend_cap_cents)
VALUES (@profile_id, @profile_name, @description, @allowed_tools, @hourly_spend_cap_cents)
ON CONFLICT (profile_id) DO UPDATE SET
    profile_name = EXCLUDED.profile_name,
    description = EXCLUDED.description,
    allowed_tools = EXCLUDED.allowed_tools,
    hourly_spend_cap_cents = EXCLUDED.hourly_spend_cap_cents;

-- name: UpsertAgentInstance :exec
INSERT INTO agent_instances (agent_id, profile_id, status)
VALUES (@agent_id, @profile_id, @status)
ON CONFLICT (agent_id) DO UPDATE SET
    profile_id = EXCLUDED.profile_id,
    status = EXCLUDED.status;

-- name: ListAgentProfiles :many
SELECT profile_id, profile_name, COALESCE(description, '')::text AS description, allowed_tools, COALESCE(hourly_spend_cap_cents, 0)::bigint AS hourly_spend_cap_cents
FROM agent_profiles
ORDER BY profile_id ASC;
