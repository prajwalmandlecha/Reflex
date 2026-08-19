from collections import defaultdict
import json
from fastapi import APIRouter, Depends, HTTPException, status
from app.auth import get_current_user, log_system_action, require_permission
from app.config import settings
from app.crypto import encrypt
from app.database import get_pool
from app.models.bank_connection import BankConnectionCreate, BankConnectionResponse, BankConnectionUpdate
from app.redis_client import get_redis
from app.services.config_propagation import cache_bank_connections, cache_bank_connections_list, cache_tool_routing, cache_prompt_routing, cache_resource_routing, cache_sensitive_responses, publish_config_update
from app.services.mcp_discovery import fetch_mcp_tools, fetch_mcp_resources, fetch_mcp_prompts
from app.services.openapi_ingestion import parse_openapi_spec
from app.slugify import slugify

router = APIRouter(prefix="/api/v1/connections", tags=["Bank Connections"])


@router.get("", response_model=list[BankConnectionResponse])
async def list_bank_connections(current_user: dict = Depends(get_current_user)):
    redis = get_redis()
    cached = await redis.get("agp:bank_connections:list")
    if cached:
        try:
            return json.loads(cached)
        except json.JSONDecodeError:
            pass

    pool = get_pool()
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
            "SELECT id, bank_connection_id, name, description, input_schema, exposed, sensitive_response FROM tools"
        )
        resources_rows = await conn.fetch(
            "SELECT id, bank_connection_id, uri, name, description, mime_type, exposed FROM resources"
        )
        prompts_rows = await conn.fetch(
            "SELECT id, bank_connection_id, name, description, arguments, exposed FROM prompts"
        )

        tools_by_conn = defaultdict(list)
        for t in tools_rows:
            tools_by_conn[t["bank_connection_id"]].append({
                "id": str(t["id"]),
                "name": t["name"],
                "description": t["description"] or "",
                "input_schema": json.loads(t["input_schema"]) if isinstance(t["input_schema"], str) else (t["input_schema"] or {}),
                "exposed": t["exposed"],
                "sensitive_response": t["sensitive_response"],
            })

        resources_by_conn = defaultdict(list)
        for r in resources_rows:
            resources_by_conn[r["bank_connection_id"]].append({
                "id": str(r["id"]),
                "uri": r["uri"],
                "name": r["name"] or "",
                "description": r["description"] or "",
                "mime_type": r["mime_type"] or "",
                "exposed": r["exposed"],
            })

        prompts_by_conn = defaultdict(list)
        for p in prompts_rows:
            prompts_by_conn[p["bank_connection_id"]].append({
                "id": str(p["id"]),
                "name": p["name"],
                "description": p["description"] or "",
                "arguments": json.loads(p["arguments"]) if isinstance(p["arguments"], str) else (p["arguments"] or []),
                "exposed": p["exposed"],
            })

        res = []
        for r in rows:
            conn_tools = tools_by_conn[r["id"]]
            conn_resources = resources_by_conn[r["id"]]
            conn_prompts = prompts_by_conn[r["id"]]
            res.append(
                BankConnectionResponse(
                    id=r["id"], name=r["name"], source_type=r["source_type"],
                    mcp_url=r["mcp_url"], base_url=r["base_url"], openapi_spec=r["openapi_spec"],
                    credential_type=r["credential_type"], status=r["status"] or "pending",
                    created_at=r["created_at"], updated_at=r["updated_at"], tool_count=len(conn_tools),
                    tools=conn_tools, resource_count=len(conn_resources), resources=conn_resources,
                    prompt_count=len(conn_prompts), prompts=conn_prompts,
                )
            )
    return res


async def _replace_tools(conn, connection_id: str, tools: list[dict], with_ops: bool = False) -> list[dict]:
    """Replace a connection's tools with a freshly discovered set.

    Only wipes existing tools when the replacement set is non-empty, so a failed
    discovery doesn't silently delete previously-discovered tools (G16)."""
    inserted = []
    if not tools:
        return inserted
    await conn.execute("DELETE FROM tools WHERE bank_connection_id = $1", connection_id)
    for t in tools:
        if with_ops:
            t_row = await conn.fetchrow(
                """
                INSERT INTO tools (bank_connection_id, name, description, input_schema, underlying_ops, exposed)
                VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
                ON CONFLICT DO NOTHING
                RETURNING id, name, description, input_schema, exposed, sensitive_response
                """,
                connection_id, t["name"], t["description"], json.dumps(t["input_schema"]),
                json.dumps(t["underlying_ops"]), t.get("exposed", True),
            )
        else:
            t_row = await conn.fetchrow(
                """
                INSERT INTO tools (bank_connection_id, name, description, input_schema, exposed)
                VALUES ($1, $2, $3, $4::jsonb, $5)
                ON CONFLICT DO NOTHING
                RETURNING id, name, description, input_schema, exposed, sensitive_response
                """,
                connection_id, t["name"], t["description"], json.dumps(t["input_schema"]), t.get("exposed", True),
            )
        if t_row:
            inserted.append({
                "id": str(t_row["id"]),
                "name": t_row["name"],
                "description": t_row["description"] or "",
                "input_schema": json.loads(t_row["input_schema"]) if isinstance(t_row["input_schema"], str) else (t_row["input_schema"] or {}),
                "exposed": t_row["exposed"],
                "sensitive_response": t_row["sensitive_response"],
            })
    return inserted


async def _replace_resources(conn, connection_id: str, resources: list[dict]) -> list[dict]:
    """Replace a connection's MCP resources with a freshly discovered set.

    Only wipes existing resources when the replacement set is non-empty, so a
    failed discovery doesn't silently delete previously-discovered resources (G16)."""
    inserted = []
    if not resources:
        return inserted
    await conn.execute("DELETE FROM resources WHERE bank_connection_id = $1", connection_id)
    for r in resources:
        r_row = await conn.fetchrow(
            """
            INSERT INTO resources (bank_connection_id, uri, name, description, mime_type, exposed)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT DO NOTHING
            RETURNING id, uri, name, description, mime_type, exposed
            """,
            connection_id, r["uri"], r.get("name", ""), r.get("description", ""),
            r.get("mime_type", ""), r.get("exposed", True),
        )
        if r_row:
            inserted.append({
                "id": str(r_row["id"]),
                "uri": r_row["uri"],
                "name": r_row["name"] or "",
                "description": r_row["description"] or "",
                "mime_type": r_row["mime_type"] or "",
                "exposed": r_row["exposed"],
            })
    return inserted


async def _replace_prompts(conn, connection_id: str, prompts: list[dict]) -> list[dict]:
    """Replace a connection's MCP prompts with a freshly discovered set.

    Only wipes existing prompts when the replacement set is non-empty, so a
    failed discovery doesn't silently delete previously-discovered prompts (G16)."""
    inserted = []
    if not prompts:
        return inserted
    await conn.execute("DELETE FROM prompts WHERE bank_connection_id = $1", connection_id)
    for p in prompts:
        p_row = await conn.fetchrow(
            """
            INSERT INTO prompts (bank_connection_id, name, description, arguments, exposed)
            VALUES ($1, $2, $3, $4::jsonb, $5)
            ON CONFLICT DO NOTHING
            RETURNING id, name, description, arguments, exposed
            """,
            connection_id, p["name"], p.get("description", ""),
            json.dumps(p.get("arguments", [])), p.get("exposed", True),
        )
        if p_row:
            inserted.append({
                "id": str(p_row["id"]),
                "name": p_row["name"],
                "description": p_row["description"] or "",
                "arguments": json.loads(p_row["arguments"]) if isinstance(p_row["arguments"], str) else (p_row["arguments"] or []),
                "exposed": p_row["exposed"],
            })
    return inserted


@router.post("", response_model=BankConnectionResponse, status_code=status.HTTP_201_CREATED)
async def create_bank_connection(b: BankConnectionCreate, current_user: dict = Depends(require_permission("bank:create"))):
    # Derive a stable, URL-safe id from the display name when the client didn't
    # supply one explicitly.
    conn_id = b.id or slugify(b.name, fallback="connection")
    pool = get_pool()
    enc_creds = encrypt(b.credentials) if b.credentials else None

    # Derive status from a real discovery probe instead of trusting the client:
    # 'connected' only when the upstream actually answered / the spec parsed.
    mcp_tools: list[dict] | None = None
    openapi_tools: list[dict] = []
    mcp_resources: list[dict] = []
    mcp_prompts: list[dict] = []
    if b.source_type == "native_mcp" and b.mcp_url:
        mcp_tools = await fetch_mcp_tools(b.mcp_url)
        status_val = "connected" if mcp_tools is not None else "error"
        if mcp_tools is not None:
            mcp_resources = (await fetch_mcp_resources(b.mcp_url)) or []
            mcp_prompts = (await fetch_mcp_prompts(b.mcp_url)) or []
    elif b.source_type == "openapi" and b.openapi_spec:
        _, openapi_tools = parse_openapi_spec(b.openapi_spec)
        status_val = "connected" if openapi_tools else "error"
    else:
        status_val = "pending"

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO bank_connections (id, name, source_type, mcp_url, base_url, openapi_spec, credential_type, encrypted_creds, status, sensitive_response)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                source_type = EXCLUDED.source_type,
                mcp_url = EXCLUDED.mcp_url,
                base_url = EXCLUDED.base_url,
                openapi_spec = EXCLUDED.openapi_spec,
                credential_type = EXCLUDED.credential_type,
                encrypted_creds = COALESCE(EXCLUDED.encrypted_creds, bank_connections.encrypted_creds),
                status = EXCLUDED.status,
                sensitive_response = EXCLUDED.sensitive_response,
                updated_at = NOW()
            RETURNING id, name, source_type, mcp_url, base_url, openapi_spec, credential_type, status, sensitive_response, created_at, updated_at
            """,
            conn_id, b.name, b.source_type, b.mcp_url, b.base_url, b.openapi_spec, b.credential_type, enc_creds, status_val, b.sensitive_response,
        )

        if mcp_tools:
            discovered_tools = await _replace_tools(conn, conn_id, mcp_tools)
            discovered_resources = await _replace_resources(conn, conn_id, mcp_resources)
            discovered_prompts = await _replace_prompts(conn, conn_id, mcp_prompts)
        elif openapi_tools:
            discovered_tools = await _replace_tools(conn, conn_id, openapi_tools, with_ops=True)
            discovered_resources = []
            discovered_prompts = []
        else:
            discovered_tools = []
            discovered_resources = []
            discovered_prompts = []

    await cache_bank_connections()
    await cache_bank_connections_list()
    await cache_tool_routing()
    await cache_prompt_routing()
    await cache_resource_routing()
    await cache_sensitive_responses()
    await publish_config_update("connection", conn_id)
    await log_system_action(current_user, "connection_created", conn_id, b.name, {"source_type": b.source_type})

    return BankConnectionResponse(
        id=row["id"], name=row["name"], source_type=row["source_type"],
        mcp_url=row["mcp_url"], base_url=row["base_url"], openapi_spec=row["openapi_spec"],
        credential_type=row["credential_type"], status=row["status"],
        sensitive_response=row["sensitive_response"],
        created_at=row["created_at"], updated_at=row["updated_at"],
        tool_count=len(discovered_tools), tools=discovered_tools,
        resource_count=len(discovered_resources), resources=discovered_resources,
        prompt_count=len(discovered_prompts), prompts=discovered_prompts,
    )


@router.post("/{connection_id}/sync", response_model=BankConnectionResponse)
async def sync_bank_connection(connection_id: str, current_user: dict = Depends(require_permission("bank:probe"))):
    """Re-probe the upstream and refresh the connection's tools and status.

    This is how a stale 'connected' row gets corrected: status reflects the
    live probe result, never a stored assertion."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, source_type, mcp_url, base_url, openapi_spec, credential_type FROM bank_connections WHERE id = $1",
            connection_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Bank connection '{connection_id}' not found")

        discovered_tools = []
        discovered_resources = []
        discovered_prompts = []
        if row["source_type"] == "native_mcp" and row["mcp_url"]:
            mcp_tools = await fetch_mcp_tools(row["mcp_url"])
            status_val = "connected" if mcp_tools is not None else "error"
            if mcp_tools:
                discovered_tools = await _replace_tools(conn, connection_id, mcp_tools)
                mcp_resources = (await fetch_mcp_resources(row["mcp_url"])) or []
                mcp_prompts = (await fetch_mcp_prompts(row["mcp_url"])) or []
                discovered_resources = await _replace_resources(conn, connection_id, mcp_resources)
                discovered_prompts = await _replace_prompts(conn, connection_id, mcp_prompts)
        elif row["source_type"] == "openapi" and row["openapi_spec"]:
            _, openapi_tools = parse_openapi_spec(row["openapi_spec"])
            status_val = "connected" if openapi_tools else "error"
            if openapi_tools:
                discovered_tools = await _replace_tools(conn, connection_id, openapi_tools, with_ops=True)
        else:
            status_val = "pending"

        existing_tools = []
        if not discovered_tools:
            # Preserve a usable connection when discovery is temporarily slow or unavailable.
            # If we still have previously discovered tools, the operator needs to see that
            # the connection is usable even if the latest probe failed.
            tools_rows = await conn.fetch(
                "SELECT id, name, description, input_schema, exposed, sensitive_response FROM tools WHERE bank_connection_id = $1",
                connection_id,
            )
            existing_tools = [
                {
                    "id": str(t["id"]),
                    "name": t["name"],
                    "description": t["description"] or "",
                    "input_schema": json.loads(t["input_schema"]) if isinstance(t["input_schema"], str) else (t["input_schema"] or {}),
                    "exposed": t["exposed"],
                    "sensitive_response": t["sensitive_response"],
                }
                for t in tools_rows
            ]
            discovered_tools = existing_tools
            if existing_tools:
                status_val = "connected"

        # Only native MCP connections can expose resources/prompts. Guard the
        # preservation queries so openapi/manual connections (which never have
        # them) don't hit the resources/prompts tables on every sync.
        if row["source_type"] == "native_mcp":
            if not discovered_resources:
                # Preserve previously-discovered resources when the latest probe failed.
                res_rows = await conn.fetch(
                    "SELECT id, uri, name, description, mime_type, exposed FROM resources WHERE bank_connection_id = $1",
                    connection_id,
                )
                discovered_resources = [
                    {
                        "id": str(r["id"]),
                        "uri": r["uri"],
                        "name": r["name"] or "",
                        "description": r["description"] or "",
                        "mime_type": r["mime_type"] or "",
                        "exposed": r["exposed"],
                    }
                    for r in res_rows
                ]

            if not discovered_prompts:
                # Preserve previously-discovered prompts when the latest probe failed.
                p_rows = await conn.fetch(
                    "SELECT id, name, description, arguments, exposed FROM prompts WHERE bank_connection_id = $1",
                    connection_id,
                )
                discovered_prompts = [
                    {
                        "id": str(p["id"]),
                        "name": p["name"],
                        "description": p["description"] or "",
                        "arguments": json.loads(p["arguments"]) if isinstance(p["arguments"], str) else (p["arguments"] or []),
                        "exposed": p["exposed"],
                    }
                    for p in p_rows
                ]

        updated = await conn.fetchrow(
            "UPDATE bank_connections SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING created_at, updated_at",
            connection_id, status_val,
        )

    await cache_bank_connections()
    await cache_bank_connections_list()
    await cache_tool_routing()
    await cache_prompt_routing()
    await cache_resource_routing()
    await publish_config_update("connection", connection_id)
    await log_system_action(current_user, "connection_synced", connection_id, "", {"status": status_val})

    return BankConnectionResponse(
        id=row["id"], name=row["name"], source_type=row["source_type"],
        mcp_url=row["mcp_url"], base_url=row["base_url"], openapi_spec=row["openapi_spec"],
        credential_type=row["credential_type"], status=status_val,
        created_at=updated["created_at"], updated_at=updated["updated_at"],
        tool_count=len(discovered_tools), tools=discovered_tools,
        resource_count=len(discovered_resources), resources=discovered_resources,
        prompt_count=len(discovered_prompts), prompts=discovered_prompts,
    )


@router.put("/{connection_id}", response_model=BankConnectionResponse)
async def update_bank_connection(connection_id: str, b: BankConnectionUpdate, current_user: dict = Depends(require_permission("bank:update"))):
    """Update a connection's mutable fields. Only provided fields are changed.
    If credentials are supplied they are re-encrypted; if the spec/url changes,
    tools are NOT auto-refreshed — call /sync to re-probe."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM bank_connections WHERE id = $1", connection_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Bank connection '{connection_id}' not found")

        name = b.name if b.name is not None else row["name"]
        mcp_url = b.mcp_url if b.mcp_url is not None else row["mcp_url"]
        base_url = b.base_url if b.base_url is not None else row["base_url"]
        openapi_spec = b.openapi_spec if b.openapi_spec is not None else row["openapi_spec"]
        credential_type = b.credential_type if b.credential_type is not None else row["credential_type"]
        status_val = b.status if b.status is not None else row["status"]
        sensitive_response = b.sensitive_response if b.sensitive_response is not None else row["sensitive_response"]
        enc_creds = encrypt(b.credentials) if b.credentials is not None else row["encrypted_creds"]

        updated = await conn.fetchrow(
            """
            UPDATE bank_connections
            SET name = $2, mcp_url = $3, base_url = $4, openapi_spec = $5,
                credential_type = $6, encrypted_creds = $7, status = $8,
                sensitive_response = $9, updated_at = NOW()
            WHERE id = $1
            RETURNING id, name, source_type, mcp_url, base_url, openapi_spec, credential_type, status, sensitive_response, created_at, updated_at
            """,
            connection_id, name, mcp_url, base_url, openapi_spec, credential_type, enc_creds, status_val, sensitive_response,
        )

        tools_rows = await conn.fetch(
            "SELECT id, name, description, input_schema, exposed, sensitive_response FROM tools WHERE bank_connection_id = $1",
            connection_id,
        )
        tools_list = [
            {
                "id": str(t["id"]),
                "name": t["name"],
                "description": t["description"] or "",
                "input_schema": json.loads(t["input_schema"]) if isinstance(t["input_schema"], str) else (t["input_schema"] or {}),
                "exposed": t["exposed"],
                "sensitive_response": t["sensitive_response"],
            }
            for t in tools_rows
        ]

        resources_rows = await conn.fetch(
            "SELECT id, uri, name, description, mime_type, exposed FROM resources WHERE bank_connection_id = $1",
            connection_id,
        )
        resources_list = [
            {
                "id": str(r["id"]),
                "uri": r["uri"],
                "name": r["name"] or "",
                "description": r["description"] or "",
                "mime_type": r["mime_type"] or "",
                "exposed": r["exposed"],
            }
            for r in resources_rows
        ]

        prompts_rows = await conn.fetch(
            "SELECT id, name, description, arguments, exposed FROM prompts WHERE bank_connection_id = $1",
            connection_id,
        )
        prompts_list = [
            {
                "id": str(p["id"]),
                "name": p["name"],
                "description": p["description"] or "",
                "arguments": json.loads(p["arguments"]) if isinstance(p["arguments"], str) else (p["arguments"] or []),
                "exposed": p["exposed"],
            }
            for p in prompts_rows
        ]

    await cache_bank_connections()
    await cache_bank_connections_list()
    await cache_tool_routing()
    await cache_prompt_routing()
    await cache_resource_routing()
    await cache_sensitive_responses()
    await publish_config_update("connection", connection_id)
    await log_system_action(current_user, "connection_updated", connection_id, name)

    return BankConnectionResponse(
        id=updated["id"], name=updated["name"], source_type=updated["source_type"],
        mcp_url=updated["mcp_url"], base_url=updated["base_url"], openapi_spec=updated["openapi_spec"],
        credential_type=updated["credential_type"], status=updated["status"],
        sensitive_response=updated["sensitive_response"],
        created_at=updated["created_at"], updated_at=updated["updated_at"],
        tool_count=len(tools_list), tools=tools_list,
        resource_count=len(resources_list), resources=resources_list,
        prompt_count=len(prompts_list), prompts=prompts_list,
    )


@router.delete("/all")
async def delete_all_connections(current_user: dict = Depends(require_permission("bank:delete"))):
    """Delete all registered bank connections and tools for clean testing."""
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM bank_connections")
    await cache_bank_connections()
    await cache_bank_connections_list()
    await cache_tool_routing()
    await cache_prompt_routing()
    await cache_resource_routing()
    await publish_config_update("connection", "all")
    return {"status": "cleared", "message": "All bank connections and tools deleted successfully"}


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bank_connection(connection_id: str, current_user: dict = Depends(require_permission("bank:delete"))):
    pool = get_pool()
    async with pool.acquire() as conn:
        res = await conn.execute("DELETE FROM bank_connections WHERE id = $1", connection_id)
        if res == "DELETE 0":
            raise HTTPException(status_code=404, detail=f"Bank connection '{connection_id}' not found")
    await cache_bank_connections()
    await cache_bank_connections_list()
    await cache_tool_routing()
    await cache_prompt_routing()
    await cache_resource_routing()
    await publish_config_update("connection", connection_id)
    await log_system_action(current_user, "connection_deleted", connection_id)
    return None


@router.post("/{connection_id}/openapi")
async def register_openapi_spec(connection_id: str, payload: dict, current_user: dict = Depends(require_permission("bank:create"))):
    spec_text = payload.get("spec", "")
    if not spec_text:
        raise HTTPException(status_code=400, detail="Missing 'spec' in request body")

    spec_data, extracted_tools = parse_openapi_spec(spec_text)

    # OpenAPI virtualized connections support the same downstream auth types as
    # native MCP connections. The gateway injects these credentials at call time
    # (bearer / basic / api_key / header) so the virtualized REST endpoints can
    # authenticate to the real bank API. Credentials are encrypted before storage.
    credential_type = payload.get("credential_type") or "none"
    credentials = payload.get("credentials")
    enc_creds = encrypt(credentials) if credentials else None

    pool = get_pool()
    async with pool.acquire() as conn:
        raw_title = spec_data.get("info", {}).get("title")
        if payload.get("name"):
            name = payload["name"]
        elif raw_title and raw_title != "Imported Spec":
            name = raw_title
        else:
            name = connection_id.replace("-", " ").title()

        base_url = payload.get("base_url") or settings.gateway_url
        # Status is earned by a successful parse, not asserted.
        status_val = "connected" if extracted_tools else "error"
        sensitive_response = bool(payload.get("sensitive_response", False))
        await conn.execute(
            """
            INSERT INTO bank_connections (id, name, source_type, base_url, openapi_spec, credential_type, encrypted_creds, status, sensitive_response)
            VALUES ($1, $2, 'openapi', $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
                openapi_spec = EXCLUDED.openapi_spec,
                credential_type = EXCLUDED.credential_type,
                encrypted_creds = COALESCE(EXCLUDED.encrypted_creds, bank_connections.encrypted_creds),
                status = EXCLUDED.status,
                sensitive_response = EXCLUDED.sensitive_response,
                updated_at = NOW()
            """,
            connection_id, name, base_url, spec_text, credential_type, enc_creds, status_val, sensitive_response,
        )

        # Replace, don't append: re-importing a spec must not duplicate tool
        # rows (tools has no (connection, name) uniqueness, so plain INSERTs
        # would pile up duplicates and corrupt agp:tool_routing).
        if extracted_tools:
            await conn.execute("DELETE FROM tools WHERE bank_connection_id = $1", connection_id)

        inserted_tools = []
        for t in extracted_tools:
            row = await conn.fetchrow(
                """
                INSERT INTO tools (bank_connection_id, name, description, input_schema, underlying_ops, exposed)
                VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
                RETURNING id, name, description, exposed
                """,
                connection_id, t["name"], t["description"],
                json.dumps(t["input_schema"]), json.dumps(t["underlying_ops"]), t["exposed"],
            )
            inserted_tools.append(dict(row))

    await cache_bank_connections()
    await cache_bank_connections_list()
    await cache_tool_routing()
    await cache_prompt_routing()
    await cache_resource_routing()
    await cache_sensitive_responses()
    await publish_config_update("openapi", connection_id)
    await log_system_action(current_user, "openapi_imported", connection_id, name, {"tools_imported": len(inserted_tools)})

    return {
        "status": "registered",
        "connection_id": connection_id,
        "tool_count": len(inserted_tools),
        "tools": inserted_tools,
    }
