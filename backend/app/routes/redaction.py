"""Redaction settings routes (/api/v1/redaction).

Admin-configurable extra sensitive keys that the gateway merges with its
built-in defaults when redacting request params and response bodies before they
reach the audit log or event stream. Stored in the global `redaction_keys` table
and propagated to the gateway via Redis (agp:redaction_keys) + config:updates.
"""

import json
from fastapi import APIRouter, Depends, HTTPException, status
from app.auth import get_current_user, log_system_action, require_permission
from app.database import get_pool
from app.services.config_propagation import cache_redaction_keys, publish_config_update

router = APIRouter(prefix="/api/v1/redaction", tags=["Redaction"])


@router.get("")
async def get_redaction_keys(current_user: dict = Depends(require_permission("settings:read"))):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT keys FROM redaction_keys WHERE id = 1")
    keys = []
    if row:
        raw = row["keys"]
        keys = json.loads(raw) if isinstance(raw, str) else (raw or [])
    return {"keys": keys}


@router.put("")
async def update_redaction_keys(
    payload: dict,
    current_user: dict = Depends(require_permission("settings:update")),
):
    keys = payload.get("keys", [])
    if not isinstance(keys, list):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"errors": ["keys must be a JSON array of strings"]},
        )
    # Normalize: lowercase, strip, dedupe, drop empties.
    normalized = []
    seen = set()
    for k in keys:
        if not isinstance(k, str):
            continue
        k = k.strip().lower()
        if k and k not in seen:
            seen.add(k)
            normalized.append(k)

    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO redaction_keys (id, keys, updated_by, updated_at)
            VALUES (1, $1, $2, NOW())
            ON CONFLICT (id) DO UPDATE SET
                keys = EXCLUDED.keys,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
            """,
            json.dumps(normalized),
            current_user.get("username") or current_user.get("role") or "admin",
        )

    await log_system_action(
        current_user,
        "redaction_keys.update",
        target_id="1",
        details={"keys": normalized},
    )

    await cache_redaction_keys()
    await publish_config_update("redaction", "1")

    return {"keys": normalized}
