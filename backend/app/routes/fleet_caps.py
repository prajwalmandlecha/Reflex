"""Global Fleet Caps routes (/api/v1/fleet-caps).

Fleet-scoped spend caps are a platform-wide governance control (single source
of truth), NOT a per-class setting. They live in the global `fleet_caps` table
and are injected into every agent's effective_constraints as shared_caps with
scope "fleet" (see config_propagation.cache_agent_instance). The gateway then
enforces them with a single shared Redis counter per tool+param across the
whole fleet.

Only Platform Administrators may read/write these caps.
"""

import json
from fastapi import APIRouter, Depends, HTTPException, status
from app.auth import get_current_user, log_system_action, require_permission
from app.database import get_pool
from app.services.config_propagation import cache_agent_instance, publish_config_update
from app.services.constraint_validation import validate_fleet_caps, validate_fleet_rate_limits

router = APIRouter(prefix="/api/v1/fleet-caps", tags=["Fleet Caps"])


async def _load_fleet_caps(conn) -> dict:
    row = await conn.fetchrow("SELECT caps FROM fleet_caps WHERE id = 1")
    if not row:
        return {}
    raw = row["caps"]
    return json.loads(raw) if isinstance(raw, str) else (raw or {})


async def _load_fleet_rate_limits(conn) -> dict:
    row = await conn.fetchrow("SELECT rate_limits FROM fleet_caps WHERE id = 1")
    if not row:
        return {}
    raw = row["rate_limits"]
    return json.loads(raw) if isinstance(raw, str) else (raw or {})


async def _repropagate_all_instances(pool) -> None:
    """Re-cache every agent instance so the new fleet caps reach the gateway."""
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id FROM agent_instances")
    for r in rows:
        await cache_agent_instance(r["id"])


@router.get("")
async def get_fleet_caps(current_user: dict = Depends(require_permission("settings:read"))):
    pool = get_pool()
    async with pool.acquire() as conn:
        caps = await _load_fleet_caps(conn)
        rate_limits = await _load_fleet_rate_limits(conn)
    return {"caps": caps, "rate_limits": rate_limits}


@router.put("")
async def update_fleet_caps(
    payload: dict,
    current_user: dict = Depends(require_permission("settings:update")),
):
    caps = payload.get("caps", {})
    rate_limits = payload.get("rate_limits", {})
    errors = await validate_fleet_caps(caps)
    errors += await validate_fleet_rate_limits(rate_limits)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"errors": errors},
        )

    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO fleet_caps (id, caps, rate_limits, updated_by, updated_at)
            VALUES (1, $1, $2, $3, NOW())
            ON CONFLICT (id) DO UPDATE SET
                caps = EXCLUDED.caps,
                rate_limits = EXCLUDED.rate_limits,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
            """,
            json.dumps(caps),
            json.dumps(rate_limits),
            current_user.get("username") or current_user.get("role") or "admin",
        )

    await log_system_action(
        current_user,
        "fleet_caps.update",
        target_id="1",
        details={"caps": caps, "rate_limits": rate_limits},
    )

    # Push the new caps to every agent so the gateway enforces them immediately.
    await _repropagate_all_instances(pool)
    await publish_config_update("fleet_caps", "1")

    return {"caps": caps, "rate_limits": rate_limits}
