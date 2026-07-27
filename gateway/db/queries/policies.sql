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