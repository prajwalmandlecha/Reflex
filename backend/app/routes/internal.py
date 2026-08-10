"""Internal API routes: called by Gateway on Redis cache miss."""

import json
from fastapi import APIRouter, HTTPException
from app.database import get_pool
from app.services.config_propagation import cache_agent_instance, collect_required_fields

router = APIRouter(prefix="/internal", tags=["Internal Gateway API"])


@router.get("/config/{agent_id}")
async def get_agent_internal_config(agent_id: str):
    """Fallback endpoint: Go Gateway calls this if Redis cache misses."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT i.id, i.class_id, i.status, i.constraint_overrides, i.cap_overrides, i.tool_overrides,
                   c.default_allowed_tools, c.default_constraints, c.default_caps
            FROM agent_instances i
            JOIN agent_classes c ON i.class_id = c.id
            WHERE i.id = $1
            """,
            agent_id,
        )
        if not row:
            # Fallback default configuration if instance not registered in DB
            return {
                "id": agent_id,
                "class_id": "default",
                "status": "active",
                "effective_tools": [],
                "effective_constraints": {},
                "effective_caps": {},
            }

        c_tools = row["default_allowed_tools"] or []
        i_tools = row["tool_overrides"]
        effective_tools = [t for t in i_tools if t in c_tools] if i_tools is not None else c_tools

        c_constraints = json.loads(row["default_constraints"]) if isinstance(row["default_constraints"], str) else (row["default_constraints"] or {})
        i_constraints = json.loads(row["constraint_overrides"]) if isinstance(row["constraint_overrides"], str) else (row["constraint_overrides"] or {})
        effective_constraints = {**c_constraints, **i_constraints}

        c_caps = json.loads(row["default_caps"]) if isinstance(row["default_caps"], str) else (row["default_caps"] or {})
        i_caps = json.loads(row["cap_overrides"]) if isinstance(row["cap_overrides"], str) else (row["cap_overrides"] or {})
        effective_caps = {**c_caps, **i_caps}

        # Propagate each tool's REQUIRED field list so the gateway can
        # distinguish required money fields (fail closed when missing) from
        # optional ones. Queried inside the pool context (conn is live here).
        tool_schemas = {}
        if effective_tools:
            tool_rows = await conn.fetch(
                "SELECT name, input_schema FROM tools WHERE name = ANY($1)",
                effective_tools,
            )
            for tr in tool_rows:
                schema = json.loads(tr["input_schema"]) if isinstance(tr["input_schema"], str) else (tr["input_schema"] or {})
                tool_schemas[tr["name"]] = {
                    "required": collect_required_fields(schema),
                }

    # Populate Redis cache as side effect
    await cache_agent_instance(agent_id)

    return {
        "id": row["id"],
        "class_id": row["class_id"],
        "status": row["status"],
        "effective_tools": effective_tools,
        "effective_constraints": effective_constraints,
        "effective_caps": effective_caps,
        "tool_schemas": tool_schemas,
    }
