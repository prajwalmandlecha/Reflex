"""Fleet control routes (/api/v1/fleet)."""

from fastapi import APIRouter
from app.database import get_pool
from app.redis_client import get_redis
from app.services.config_propagation import publish_config_update

router = APIRouter(prefix="/api/v1/fleet", tags=["Fleet Control"])


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


@router.post("/halt")
async def halt_fleet():
    redis = get_redis()
    await redis.set("agp:kill:fleet", "1")
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO stop_events (scope, action, reason) VALUES ('fleet', 'stop', 'Fleet emergency stop triggered by operator')")
        await conn.execute("UPDATE agent_instances SET status = 'killed', updated_at = NOW() WHERE status = 'active'")
    await publish_config_update("halt_fleet", "fleet")
    return {"fleet": "halted"}


@router.delete("/halt")
async def resume_fleet():
    redis = get_redis()
    await redis.delete("agp:kill:fleet")
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO stop_events (scope, action, reason) VALUES ('fleet', 'resume', 'Fleet resumed by operator')")
        await conn.execute("UPDATE agent_instances SET status = 'active', updated_at = NOW() WHERE status = 'killed'")
    await publish_config_update("resume_fleet", "fleet")
    return {"fleet": "resumed"}
