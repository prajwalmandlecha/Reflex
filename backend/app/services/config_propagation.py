"""Config propagation service: writes config to Redis cache and publishes pub/sub notifications."""

from __future__ import annotations

import functools
import json
import logging
from typing import Any

from app.database import get_pool
from app.redis_client import get_redis

logger = logging.getLogger(__name__)


def _non_fatal_cache(fn):
    """Cache writes must not 500 a request after the DB write already committed.

    A Redis outage degrades the gateway's fast-path config lookup (it falls back
    to the backend /internal/config endpoint and its 30s Postgres poll), so log
    the failure and let the request succeed rather than leaving DB and operator
    out of sync."""
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except Exception as e:
            logger.error("%s failed (non-fatal, cache will re-converge): %s", fn.__name__, e)
            return None
    return wrapper


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
    """Notify subscribers (gateway) of a config update via Redis pub/sub.

    Non-fatal: a Redis outage must not 500 a request AFTER the DB write already
    committed (which would leave the operator thinking the change failed while
    the DB says it succeeded). Log the failure; the gateway's 30s Postgres poll
    and the next successful publish will re-converge the cache."""
    try:
        ver = await bump_config_version()
        redis = get_redis()
        payload = json.dumps({"type": change_type, "id": item_id, "version": ver})
        await redis.publish("config:updates", payload)
        logger.info("Published config:update type=%s id=%s version=%d", change_type, item_id, ver)
    except Exception as e:
        logger.error("config:update publish FAILED (DB already committed) type=%s id=%s: %s", change_type, item_id, e)


@_non_fatal_cache
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


@_non_fatal_cache
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


@_non_fatal_cache
async def cache_active_policies():
    """Concatenate all active Rego policies and store in Redis."""
    pool = get_pool()
    redis = get_redis()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT name, rego_source FROM policies WHERE status = 'active' ORDER BY id ASC"
        )
        sources = [r["rego_source"] for r in rows if r["rego_source"]]
        combined = "\n\n".join(sources) if sources else ""
        await redis.set("agp:policy:active", combined)


@_non_fatal_cache
async def cache_bank_connections():
    """Cache bank connection endpoints map in Redis."""
    pool = get_pool()
    redis = get_redis()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, source_type, mcp_url, base_url, openapi_spec, status FROM bank_connections WHERE status = 'connected'"
        )
        mapping = {}
        for r in rows:
            mapping[r["id"]] = {
                "id": r["id"],
                "name": r["name"],
                "source_type": r["source_type"],
                "mcp_url": r["mcp_url"],
                "base_url": r["base_url"],
                # Include the raw spec so the gateway can virtualize OpenAPI
                # connections into MCP tools (G7).
                "openapi_spec": r["openapi_spec"],
            }
        await redis.set("agp:connections", json.dumps(mapping))


@_non_fatal_cache
async def cache_tool_routing():
    """Cache tool_name → bank_connection_id mapping in Redis for gateway routing."""
    pool = get_pool()
    redis = get_redis()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT name, bank_connection_id FROM tools WHERE exposed = true"
        )
        mapping = {r["name"]: r["bank_connection_id"] for r in rows}
        await redis.set("agp:tool_routing", json.dumps(mapping))
