"""Config propagation service: writes config to Redis cache and publishes pub/sub notifications."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.database import get_pool
from app.redis_client import get_redis

logger = logging.getLogger(__name__)


async def bump_config_version() -> int:
    """Increment monotonically increasing config version in Postgres (atomic upsert)."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO config_version (id, version, updated_at)
            VALUES (1, 1, NOW())
            ON CONFLICT (id) DO UPDATE SET version = config_version.version + 1, updated_at = NOW()
            RETURNING version
            """
        )
        return row["version"] if row else 1


async def publish_config_update(change_type: str, item_id: str):
    """Notify subscribers (gateway) of a config update via Redis pub/sub."""
    ver = await bump_config_version()
    redis = get_redis()
    payload = json.dumps({"type": change_type, "id": item_id, "version": ver})
    await redis.publish("config:updates", payload)
    logger.info("Published config:update type=%s id=%s version=%d", change_type, item_id, ver)


async def cache_agent_class(class_id: str):
    """Compute and cache AgentClass config in Redis."""
    pool = get_pool()
    redis = get_redis()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, default_allowed_tools, default_constraints, default_caps, status FROM agent_classes WHERE id = $1",
            class_id,
        )
        if not row:
            await redis.delete(f"agp:class:{class_id}")
            return

        data = {
            "id": row["id"],
            "name": row["name"],
            "default_allowed_tools": row["default_allowed_tools"] or [],
            "default_constraints": json.loads(row["default_constraints"]) if isinstance(row["default_constraints"], str) else (row["default_constraints"] or {}),
            "default_caps": json.loads(row["default_caps"]) if isinstance(row["default_caps"], str) else (row["default_caps"] or {}),
            "status": row["status"],
        }
        await redis.set(f"agp:class:{class_id}", json.dumps(data))


async def cache_agent_instance(agent_id: str):
    """Compute effective instance config (merged class + instance overrides) and cache in Redis."""
    pool = get_pool()
    redis = get_redis()
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
            await redis.delete(f"agp:inst:{agent_id}")
            return

        c_tools = row["default_allowed_tools"] or []
        i_tools = row["tool_overrides"]
        effective_tools = i_tools if i_tools is not None else c_tools

        c_constraints = json.loads(row["default_constraints"]) if isinstance(row["default_constraints"], str) else (row["default_constraints"] or {})
        i_constraints = json.loads(row["constraint_overrides"]) if isinstance(row["constraint_overrides"], str) else (row["constraint_overrides"] or {})
        effective_constraints = {**c_constraints, **i_constraints}

        c_caps = json.loads(row["default_caps"]) if isinstance(row["default_caps"], str) else (row["default_caps"] or {})
        i_caps = json.loads(row["cap_overrides"]) if isinstance(row["cap_overrides"], str) else (row["cap_overrides"] or {})
        effective_caps = {**c_caps, **i_caps}

        data = {
            "id": row["id"],
            "class_id": row["class_id"],
            "status": row["status"],
            "effective_tools": effective_tools,
            "effective_constraints": effective_constraints,
            "effective_caps": effective_caps,
        }
        await redis.set(f"agp:inst:{agent_id}", json.dumps(data))


async def cache_active_policies():
    """Concatenate all active Rego policies and store in Redis."""
    pool = get_pool()
    redis = get_redis()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT name, rego_source FROM policies WHERE status = 'active' AND type = 'rego' ORDER BY id ASC"
        )
        sources = [r["rego_source"] for r in rows if r["rego_source"]]
        combined = "\n\n".join(sources) if sources else ""
        await redis.set("agp:policy:active", combined)


async def cache_bank_connections():
    """Cache bank connection endpoints map in Redis."""
    pool = get_pool()
    redis = get_redis()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, source_type, mcp_url, base_url, status FROM bank_connections WHERE status = 'connected'"
        )
        mapping = {}
        for r in rows:
            mapping[r["id"]] = {
                "id": r["id"],
                "name": r["name"],
                "source_type": r["source_type"],
                "mcp_url": r["mcp_url"],
                "base_url": r["base_url"],
            }
        await redis.set("agp:connections", json.dumps(mapping))
