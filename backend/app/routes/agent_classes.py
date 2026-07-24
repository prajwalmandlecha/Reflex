"""Agent Classes routes (/api/v1/classes)."""

import json
from fastapi import APIRouter, HTTPException, status
from app.database import get_pool
from app.models.agent_class import AgentClassCreate, AgentClassResponse, AgentClassUpdate
from app.redis_client import get_redis
from app.services.config_propagation import cache_agent_class, publish_config_update

router = APIRouter(prefix="/api/v1/classes", tags=["Agent Classes"])


@router.get("", response_model=list[AgentClassResponse])
async def list_agent_classes():
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT c.id, c.name, c.description, c.default_allowed_tools, c.default_constraints,
                   c.default_caps, c.status, c.created_at, c.updated_at,
                   COUNT(i.id)::int AS instance_count
            FROM agent_classes c
            LEFT JOIN agent_instances i ON c.id = i.class_id
            GROUP BY c.id
            ORDER BY c.name ASC
            """
        )

    res = []
    for r in rows:
        constraints = json.loads(r["default_constraints"]) if isinstance(r["default_constraints"], str) else (r["default_constraints"] or {})
        caps = json.loads(r["default_caps"]) if isinstance(r["default_caps"], str) else (r["default_caps"] or {})
        res.append(AgentClassResponse(
            id=r["id"],
            name=r["name"],
            description=r["description"] or "",
            default_allowed_tools=r["default_allowed_tools"] or [],
            default_constraints=constraints,
            default_caps=caps,
            status=r["status"] or "active",
            created_at=r["created_at"],
            updated_at=r["updated_at"],
            instance_count=r["instance_count"],
        ))
    return res


@router.post("", response_model=AgentClassResponse, status_code=status.HTTP_201_CREATED)
async def create_agent_class(cls: AgentClassCreate):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO agent_classes (id, name, description, default_allowed_tools, default_constraints, default_caps, status)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                default_allowed_tools = EXCLUDED.default_allowed_tools,
                default_constraints = EXCLUDED.default_constraints,
                default_caps = EXCLUDED.default_caps,
                status = EXCLUDED.status,
                updated_at = NOW()
            RETURNING id, name, description, default_allowed_tools, default_constraints, default_caps, status, created_at, updated_at
            """,
            cls.id, cls.name, cls.description, cls.default_allowed_tools,
            json.dumps(cls.default_constraints), json.dumps(cls.default_caps), cls.status,
        )

    await cache_agent_class(cls.id)
    await publish_config_update("class", cls.id)

    constraints = json.loads(row["default_constraints"]) if isinstance(row["default_constraints"], str) else (row["default_constraints"] or {})
    caps = json.loads(row["default_caps"]) if isinstance(row["default_caps"], str) else (row["default_caps"] or {})
    return AgentClassResponse(
        id=row["id"], name=row["name"], description=row["description"] or "",
        default_allowed_tools=row["default_allowed_tools"] or [],
        default_constraints=constraints, default_caps=caps, status=row["status"],
        created_at=row["created_at"], updated_at=row["updated_at"], instance_count=0,
    )


@router.get("/{class_id}", response_model=AgentClassResponse)
async def get_agent_class(class_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT c.id, c.name, c.description, c.default_allowed_tools, c.default_constraints,
                   c.default_caps, c.status, c.created_at, c.updated_at,
                   COUNT(i.id)::int AS instance_count
            FROM agent_classes c
            LEFT JOIN agent_instances i ON c.id = i.class_id
            WHERE c.id = $1
            GROUP BY c.id
            """,
            class_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Agent class '{class_id}' not found")

    constraints = json.loads(row["default_constraints"]) if isinstance(row["default_constraints"], str) else (row["default_constraints"] or {})
    caps = json.loads(row["default_caps"]) if isinstance(row["default_caps"], str) else (row["default_caps"] or {})
    return AgentClassResponse(
        id=row["id"], name=row["name"], description=row["description"] or "",
        default_allowed_tools=row["default_allowed_tools"] or [],
        default_constraints=constraints, default_caps=caps, status=row["status"],
        created_at=row["created_at"], updated_at=row["updated_at"], instance_count=row["instance_count"],
    )


@router.put("/{class_id}", response_model=AgentClassResponse)
async def update_agent_class(class_id: str, cls: AgentClassUpdate):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM agent_classes WHERE id = $1", class_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Agent class '{class_id}' not found")

        name = cls.name if cls.name is not None else row["name"]
        description = cls.description if cls.description is not None else row["description"]
        tools = cls.default_allowed_tools if cls.default_allowed_tools is not None else row["default_allowed_tools"]
        constraints = json.dumps(cls.default_constraints) if cls.default_constraints is not None else row["default_constraints"]
        caps = json.dumps(cls.default_caps) if cls.default_caps is not None else row["default_caps"]
        status_val = cls.status if cls.status is not None else row["status"]

        updated = await conn.fetchrow(
            """
            UPDATE agent_classes
            SET name = $1, description = $2, default_allowed_tools = $3,
                default_constraints = $4::jsonb, default_caps = $5::jsonb,
                status = $6, updated_at = NOW()
            WHERE id = $7
            RETURNING id, name, description, default_allowed_tools, default_constraints, default_caps, status, created_at, updated_at
            """,
            name, description, tools, constraints, caps, status_val, class_id,
        )

    await cache_agent_class(class_id)
    await publish_config_update("class", class_id)

    u_constraints = json.loads(updated["default_constraints"]) if isinstance(updated["default_constraints"], str) else (updated["default_constraints"] or {})
    u_caps = json.loads(updated["default_caps"]) if isinstance(updated["default_caps"], str) else (updated["default_caps"] or {})
    return AgentClassResponse(
        id=updated["id"], name=updated["name"], description=updated["description"] or "",
        default_allowed_tools=updated["default_allowed_tools"] or [],
        default_constraints=u_constraints, default_caps=u_caps, status=updated["status"],
        created_at=updated["created_at"], updated_at=updated["updated_at"], instance_count=0,
    )


@router.post("/{class_id}/revoke")
async def revoke_agent_class(class_id: str):
    redis = get_redis()
    await redis.set(f"agp:kill:class:{class_id}", "1")
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO stop_events (scope, target_id, action, reason) VALUES ('class', $1, 'stop', 'Class stop triggered by operator')", class_id)
        await conn.execute("UPDATE agent_instances SET status = 'killed', updated_at = NOW() WHERE class_id = $1 AND status = 'active'", class_id)
    await publish_config_update("kill_class", class_id)
    return {"status": "revoked", "class_id": class_id}


@router.delete("/{class_id}/revoke")
async def revive_agent_class(class_id: str):
    redis = get_redis()
    await redis.delete(f"agp:kill:class:{class_id}")
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO stop_events (scope, target_id, action, reason) VALUES ('class', $1, 'resume', 'Class resumed by operator')", class_id)
        await conn.execute("UPDATE agent_instances SET status = 'active', updated_at = NOW() WHERE class_id = $1 AND status = 'killed'", class_id)
    await publish_config_update("revive_class", class_id)
    return {"status": "active", "class_id": class_id}
