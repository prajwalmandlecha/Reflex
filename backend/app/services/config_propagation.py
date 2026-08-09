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


def _build_downstream_auth(credential_type: str | None, encrypted_creds: str | None) -> dict | None:
    """Decrypt a connection's stored credentials into a downstream-auth descriptor
    the gateway can inject at proxy time. Returns None when no creds are set.

    The gateway never sees FERNET_KEY — the backend decrypts here and hands the
    gateway the ready-to-use secret via Redis (which is already the trusted
    config channel)."""
    if not encrypted_creds or not credential_type:
        return None
    try:
        from app.crypto import decrypt
        secret = decrypt(encrypted_creds)
    except Exception as e:
        logger.error("failed to decrypt creds for downstream auth (skipping): %s", e)
        return None
    return {"type": credential_type, "secret": secret}


@_non_fatal_cache
async def cache_bank_connections():
    """Cache bank connection endpoints map in Redis."""
    pool = get_pool()
    redis = get_redis()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, source_type, mcp_url, base_url, openapi_spec, credential_type, encrypted_creds, status FROM bank_connections WHERE status = 'connected'"
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
                # Decrypted downstream credentials for the gateway to inject.
                "downstream_auth": _build_downstream_auth(r["credential_type"], r["encrypted_creds"]),
            }
        await redis.set("agp:connections", json.dumps(mapping))


@_non_fatal_cache
async def cache_bank_connections_list():
    """Cache the full bank-connections list response for fast UI reads."""
    pool = get_pool()
    redis = get_redis()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT b.id, b.name, b.source_type, b.mcp_url, b.base_url, b.openapi_spec, b.credential_type,
                   b.status, b.created_at, b.updated_at
            FROM bank_connections b
            ORDER BY b.name ASC
            """
        )
        tools_rows = await conn.fetch(
            "SELECT id, bank_connection_id, name, description, input_schema, exposed FROM tools"
        )

    tools_by_conn: dict[str, list[dict[str, Any]]] = {}
    for t in tools_rows:
        tools_by_conn.setdefault(t["bank_connection_id"], []).append({
            "id": str(t["id"]),
            "name": t["name"],
            "description": t["description"] or "",
            "input_schema": json.loads(t["input_schema"]) if isinstance(t["input_schema"], str) else (t["input_schema"] or {}),
            "exposed": t["exposed"],
        })

    payload = []
    for r in rows:
        conn_tools = tools_by_conn.get(r["id"], [])
        payload.append({
            "id": r["id"],
            "name": r["name"],
            "source_type": r["source_type"],
            "mcp_url": r["mcp_url"],
            "base_url": r["base_url"],
            "openapi_spec": r["openapi_spec"],
            "credential_type": r["credential_type"],
            "status": r["status"] or "pending",
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
            "tool_count": len(conn_tools),
            "tools": conn_tools,
        })

    await redis.set("agp:bank_connections:list", json.dumps(payload))


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
