"""Agent Instances routes (/api/v1/agents)."""

import json
from fastapi import APIRouter, HTTPException, status
from app.database import get_pool
from app.models.agent_instance import AgentInstanceCreate, AgentInstanceResponse, AgentInstanceUpdate
from app.redis_client import get_redis
from app.routes.tokens import create_agent_jwt
from app.services.config_propagation import cache_agent_instance, publish_config_update

router = APIRouter(prefix="/api/v1/agents", tags=["Agent Instances"])


@router.get("", response_model=list[AgentInstanceResponse])
async def list_agent_instances():
    pool = get_pool()
    redis = get_redis()
    fleet_halted = bool(await redis.get("agp:kill:fleet"))

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT i.id, i.class_id, i.status, i.constraint_overrides, i.cap_overrides, i.tool_overrides,
                   i.created_at, i.updated_at, c.name AS class_name
            FROM agent_instances i
            LEFT JOIN agent_classes c ON i.class_id = c.id
            ORDER BY i.id ASC
            """
        )

    res = []
    for r in rows:
        constraints = json.loads(r["constraint_overrides"]) if isinstance(r["constraint_overrides"], str) else (r["constraint_overrides"] or {})
        caps = json.loads(r["cap_overrides"]) if isinstance(r["cap_overrides"], str) else (r["cap_overrides"] or {})
        updated_dt = r["updated_at"] or r["created_at"]
        last_seen_val = updated_dt.isoformat() if updated_dt else ""

        status_val = r["status"] or "active"
        if fleet_halted and status_val != "revoked":
            status_val = "killed"
        else:
            class_killed = bool(await redis.get(f"agp:kill:class:{r['class_id']}"))
            agent_killed = bool(await redis.get(f"agp:kill:agent:{r['id']}"))
            if (class_killed or agent_killed) and status_val == "active":
                status_val = "killed"

        res.append(AgentInstanceResponse(
            id=r["id"],
            class_id=r["class_id"],
            status=status_val,
            constraint_overrides=constraints,
            cap_overrides=caps,
            tool_overrides=r["tool_overrides"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
            last_seen=last_seen_val,
            class_name=r["class_name"] or r["class_id"],
        ))
    return res


@router.post("", response_model=AgentInstanceResponse, status_code=status.HTTP_201_CREATED)
async def register_agent_instance(inst: AgentInstanceCreate):
    pool = get_pool()
    async with pool.acquire() as conn:
        cls = await conn.fetchrow("SELECT id, name FROM agent_classes WHERE id = $1", inst.class_id)
        if not cls:
            raise HTTPException(status_code=400, detail=f"Agent class '{inst.class_id}' does not exist")

        row = await conn.fetchrow(
            """
            INSERT INTO agent_instances (id, class_id, status, constraint_overrides, cap_overrides, tool_overrides)
            VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
            ON CONFLICT (id) DO UPDATE SET
                class_id = EXCLUDED.class_id,
                status = EXCLUDED.status,
                constraint_overrides = EXCLUDED.constraint_overrides,
                cap_overrides = EXCLUDED.cap_overrides,
                tool_overrides = EXCLUDED.tool_overrides,
                updated_at = NOW()
            RETURNING id, class_id, status, constraint_overrides, cap_overrides, tool_overrides, created_at, updated_at
            """,
            inst.id, inst.class_id, inst.status,
            json.dumps(inst.constraint_overrides), json.dumps(inst.cap_overrides), inst.tool_overrides,
        )

    await cache_agent_instance(inst.id)
    await publish_config_update("instance", inst.id)

    # Mint signed JWT for the newly created agent instance
    token = create_agent_jwt(inst.id, agent_kind=inst.class_id)

    constraints = json.loads(row["constraint_overrides"]) if isinstance(row["constraint_overrides"], str) else (row["constraint_overrides"] or {})
    caps = json.loads(row["cap_overrides"]) if isinstance(row["cap_overrides"], str) else (row["cap_overrides"] or {})
    return AgentInstanceResponse(
        id=row["id"], class_id=row["class_id"], status=row["status"],
        constraint_overrides=constraints, cap_overrides=caps, tool_overrides=row["tool_overrides"],
        created_at=row["created_at"], updated_at=row["updated_at"], class_name=cls["name"],
        jwt_token=token,
    )


@router.get("/{agent_id}", response_model=AgentInstanceResponse)
async def get_agent_instance(agent_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT i.id, i.class_id, i.status, i.constraint_overrides, i.cap_overrides, i.tool_overrides,
                   i.created_at, i.updated_at, c.name AS class_name
            FROM agent_instances i
            LEFT JOIN agent_classes c ON i.class_id = c.id
            WHERE i.id = $1
            """,
            agent_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Agent instance '{agent_id}' not found")

    constraints = json.loads(row["constraint_overrides"]) if isinstance(row["constraint_overrides"], str) else (row["constraint_overrides"] or {})
    caps = json.loads(row["cap_overrides"]) if isinstance(row["cap_overrides"], str) else (row["cap_overrides"] or {})
    last_seen_val = (row["updated_at"] or row["created_at"]).isoformat() if (row["updated_at"] or row["created_at"]) else ""
    return AgentInstanceResponse(
        id=row["id"], class_id=row["class_id"], status=row["status"],
        constraint_overrides=constraints, cap_overrides=caps, tool_overrides=row["tool_overrides"],
        created_at=row["created_at"], updated_at=row["updated_at"], last_seen=last_seen_val,
        class_name=row["class_name"] or row["class_id"],
    )


@router.put("/{agent_id}", response_model=AgentInstanceResponse)
async def update_agent_instance(agent_id: str, inst: AgentInstanceUpdate):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM agent_instances WHERE id = $1", agent_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Agent instance '{agent_id}' not found")

        class_id = inst.class_id if inst.class_id is not None else row["class_id"]
        status_val = inst.status if inst.status is not None else row["status"]
        constraints = json.dumps(inst.constraint_overrides) if inst.constraint_overrides is not None else row["constraint_overrides"]
        caps = json.dumps(inst.cap_overrides) if inst.cap_overrides is not None else row["cap_overrides"]
        tools = inst.tool_overrides if inst.tool_overrides is not None else row["tool_overrides"]

        updated = await conn.fetchrow(
            """
            UPDATE agent_instances
            SET class_id = $1, status = $2, constraint_overrides = $3::jsonb,
                cap_overrides = $4::jsonb, tool_overrides = $5, updated_at = NOW()
            WHERE id = $6
            RETURNING id, class_id, status, constraint_overrides, cap_overrides, tool_overrides, created_at, updated_at
            """,
            class_id, status_val, constraints, caps, tools, agent_id,
        )

    await cache_agent_instance(agent_id)
    await publish_config_update("instance", agent_id)

    u_constraints = json.loads(updated["constraint_overrides"]) if isinstance(updated["constraint_overrides"], str) else (updated["constraint_overrides"] or {})
    u_caps = json.loads(updated["cap_overrides"]) if isinstance(updated["cap_overrides"], str) else (updated["cap_overrides"] or {})
    return AgentInstanceResponse(
        id=updated["id"], class_id=updated["class_id"], status=updated["status"],
        constraint_overrides=u_constraints, cap_overrides=u_caps, tool_overrides=updated["tool_overrides"],
        created_at=updated["created_at"], updated_at=updated["updated_at"], class_name=class_id,
    )


@router.post("/{agent_id}/revoke")
async def revoke_agent_instance(agent_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("UPDATE agent_instances SET status = 'revoked', updated_at = NOW() WHERE id = $1", agent_id)

    redis = get_redis()
    await redis.set(f"agp:kill:agent:{agent_id}", "1")
    await cache_agent_instance(agent_id)
    await publish_config_update("kill_agent", agent_id)
    return {"status": "revoked", "agent_id": agent_id}


@router.delete("/{agent_id}/revoke")
async def revive_agent_instance(agent_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("UPDATE agent_instances SET status = 'active', updated_at = NOW() WHERE id = $1", agent_id)

    redis = get_redis()
    await redis.delete(f"agp:kill:agent:{agent_id}")
    await cache_agent_instance(agent_id)
