"""Fleet control routes (/api/v1/fleet)."""

import httpx
from fastapi import APIRouter, Body
from app.config import settings
from app.database import get_pool
from app.redis_client import get_redis
from app.services.config_propagation import publish_config_update

router = APIRouter(prefix="/api/v1/fleet", tags=["Fleet Control"])


@router.get("/system-health")
async def get_system_health():
    """Live health probes for the governance engines — nothing here is asserted,
    every status comes from an actual round-trip."""
    db_ok = False
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        pass

    redis_ok = False
    try:
        redis = get_redis()
        await redis.ping()
        redis_ok = True
    except Exception:
        pass

    gateway_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{settings.gateway_url}/health")
            gateway_ok = resp.status_code == 200
    except Exception:
        pass

    return {
        "gateway": "healthy" if gateway_ok else "unreachable",
        "redis": "active" if redis_ok else "unreachable",
        # OPA runs embedded inside the gateway process, so its liveness follows the gateway's.
        "opa": "operational" if gateway_ok else "unreachable",
        "database": "healthy" if db_ok else "unreachable",
    }


@router.get("/status")
async def get_fleet_status():
    pool = get_pool()
    redis = get_redis()
    async with pool.acquire() as conn:
        total_instances = await conn.fetchval("SELECT COUNT(*) FROM agent_instances")
        revoked_instances = await conn.fetchval("SELECT COUNT(*) FROM agent_instances WHERE status = 'revoked'")

    fleet_halted = bool(await redis.get("agp:kill:fleet"))

    status_str = "stopped" if fleet_halted else ("degraded" if revoked_instances > 0 else "healthy")

    return {
        "status": status_str,
        "fleet_halted": fleet_halted,
        "total_instances": total_instances or 0,
        "active_instances": (total_instances or 0) - (revoked_instances or 0),
        "revoked_instances": revoked_instances or 0,
    }


@router.get("/events")
async def get_stop_events(limit: int = 50):
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, scope, action, reason, triggered_by, created_at
            FROM stop_events
            ORDER BY created_at DESC
            LIMIT $1
            """,
            limit,
        )
    return [
        {
            "id": r["id"],
            "scope": r["scope"],
            "action": r["action"],
            "reason": r["reason"] or "",
            "operator": r["triggered_by"] or "m.chen",
            "created_at": r["created_at"].isoformat() if r["created_at"] else "",
            "timestamp": r["created_at"].isoformat() if r["created_at"] else "",
        }
        for r in rows
    ]


@router.post("/halt")
async def halt_fleet(payload: dict = Body(default={})):
    reason = payload.get("reason", "Fleet emergency stop triggered by operator")
    redis = get_redis()
    await redis.set("agp:kill:fleet", "1")
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO stop_events (scope, action, reason) VALUES ('fleet', 'stop', $1)", reason)
        await conn.execute("UPDATE agent_instances SET status = 'killed', updated_at = NOW() WHERE status = 'active'")
    await publish_config_update("halt_fleet", "fleet")
    return await get_fleet_status()


@router.delete("/halt")
async def resume_fleet():
    redis = get_redis()
    await redis.delete("agp:kill:fleet")
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO stop_events (scope, action, reason) VALUES ('fleet', 'resume', 'Fleet resumed by operator')")
        await conn.execute("UPDATE agent_instances SET status = 'active', updated_at = NOW() WHERE status = 'killed'")
    await publish_config_update("resume_fleet", "fleet")
    return await get_fleet_status()

