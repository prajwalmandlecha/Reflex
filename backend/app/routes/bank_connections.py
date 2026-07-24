"""Bank Connections routes (/api/v1/connections)."""

import json
from fastapi import APIRouter, HTTPException, status
from app.crypto import encrypt
from app.database import get_pool
from app.models.bank_connection import BankConnectionCreate, BankConnectionResponse, BankConnectionUpdate
from app.services.config_propagation import cache_bank_connections, publish_config_update
from app.services.mcp_discovery import fetch_mcp_tools
from app.services.openapi_ingestion import parse_openapi_spec

router = APIRouter(prefix="/api/v1/connections", tags=["Bank Connections"])


@router.get("", response_model=list[BankConnectionResponse])
async def list_bank_connections():
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT b.id, b.name, b.source_type, b.mcp_url, b.base_url, b.openapi_spec, b.credential_type,
                   b.status, b.created_at, b.updated_at, COUNT(t.id)::int AS tool_count
            FROM bank_connections b
            LEFT JOIN tools t ON b.id = t.bank_connection_id
            GROUP BY b.id
            ORDER BY b.name ASC
            """
        )

        res = []
        for r in rows:
            tools_rows = await conn.fetch(
                "SELECT id, name, description, input_schema, exposed FROM tools WHERE bank_connection_id = $1",
                r["id"],
            )
            tools_list = [
                {
                    "id": str(t["id"]),
                    "name": t["name"],
                    "description": t["description"] or "",
                    "input_schema": json.loads(t["input_schema"]) if isinstance(t["input_schema"], str) else (t["input_schema"] or {}),
                    "exposed": t["exposed"],
                }
                for t in tools_rows
            ]
            res.append(
                BankConnectionResponse(
                    id=r["id"], name=r["name"], source_type=r["source_type"],
                    mcp_url=r["mcp_url"], base_url=r["base_url"], openapi_spec=r["openapi_spec"],
                    credential_type=r["credential_type"], status=r["status"] or "connected",
                    created_at=r["created_at"], updated_at=r["updated_at"], tool_count=r["tool_count"],
                    tools=tools_list,
                )
            )
    return res


@router.post("", response_model=BankConnectionResponse, status_code=status.HTTP_201_CREATED)
async def create_bank_connection(b: BankConnectionCreate):
    pool = get_pool()
    enc_creds = encrypt(b.credentials) if b.credentials else None
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO bank_connections (id, name, source_type, mcp_url, base_url, openapi_spec, credential_type, encrypted_creds, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                source_type = EXCLUDED.source_type,
                mcp_url = EXCLUDED.mcp_url,
                base_url = EXCLUDED.base_url,
                openapi_spec = EXCLUDED.openapi_spec,
                credential_type = EXCLUDED.credential_type,
                encrypted_creds = COALESCE(EXCLUDED.encrypted_creds, bank_connections.encrypted_creds),
                status = EXCLUDED.status,
                updated_at = NOW()
            RETURNING id, name, source_type, mcp_url, base_url, openapi_spec, credential_type, status, created_at, updated_at
            """,
            b.id, b.name, b.source_type, b.mcp_url, b.base_url, b.openapi_spec, b.credential_type, enc_creds, b.status,
        )

        # Auto-discover tools if native_mcp or openapi
        discovered_tools = []
        if b.source_type == "native_mcp" and b.mcp_url:
            mcp_tools = fetch_mcp_tools(b.mcp_url)
            for t in mcp_tools:
                t_row = await conn.fetchrow(
                    """
                    INSERT INTO tools (bank_connection_id, name, description, input_schema, exposed)
                    VALUES ($1, $2, $3, $4::jsonb, $5)
                    ON CONFLICT DO NOTHING
                    RETURNING id, name, description, input_schema, exposed
                    """,
                    b.id, t["name"], t["description"], json.dumps(t["input_schema"]), t.get("exposed", True),
                )
                if t_row:
                    discovered_tools.append({
                        "id": str(t_row["id"]),
                        "name": t_row["name"],
                        "description": t_row["description"] or "",
                        "input_schema": json.loads(t_row["input_schema"]) if isinstance(t_row["input_schema"], str) else (t_row["input_schema"] or {}),
                        "exposed": t_row["exposed"],
                    })
        elif b.source_type == "openapi" and b.openapi_spec:
            _, openapi_tools = parse_openapi_spec(b.openapi_spec)
            for t in openapi_tools:
                t_row = await conn.fetchrow(
                    """
                    INSERT INTO tools (bank_connection_id, name, description, input_schema, underlying_ops, exposed)
                    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
                    ON CONFLICT DO NOTHING
                    RETURNING id, name, description, input_schema, exposed
                    """,
                    b.id, t["name"], t["description"], json.dumps(t["input_schema"]), json.dumps(t["underlying_ops"]), t.get("exposed", True),
                )
                if t_row:
                    discovered_tools.append({
                        "id": str(t_row["id"]),
                        "name": t_row["name"],
                        "description": t_row["description"] or "",
                        "input_schema": json.loads(t_row["input_schema"]) if isinstance(t_row["input_schema"], str) else (t_row["input_schema"] or {}),
                        "exposed": t_row["exposed"],
                    })

    await cache_bank_connections()
    await publish_config_update("connection", b.id)

    return BankConnectionResponse(
        id=row["id"], name=row["name"], source_type=row["source_type"],
        mcp_url=row["mcp_url"], base_url=row["base_url"], openapi_spec=row["openapi_spec"],
        credential_type=row["credential_type"], status=row["status"],
        created_at=row["created_at"], updated_at=row["updated_at"],
        tool_count=len(discovered_tools), tools=discovered_tools,
    )


@router.delete("/all")
async def delete_all_connections():
    """Delete all registered bank connections and tools for clean testing."""
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM bank_connections")
    await cache_bank_connections()
    await publish_config_update("connection", "all")
    return {"status": "cleared", "message": "All bank connections and tools deleted successfully"}


@router.post("/{connection_id}/openapi")
async def register_openapi_spec(connection_id: str, payload: dict):
    spec_text = payload.get("spec", "")
    if not spec_text:
        raise HTTPException(status_code=400, detail="Missing 'spec' in request body")

    spec_data, extracted_tools = parse_openapi_spec(spec_text)

    pool = get_pool()
    async with pool.acquire() as conn:
        raw_title = spec_data.get("info", {}).get("title")
        if payload.get("name"):
            name = payload["name"]
        elif raw_title and raw_title != "Imported Spec":
            name = raw_title
        else:
            name = connection_id.replace("-", " ").title()

        base_url = payload.get("base_url", "http://localhost:8080")
        await conn.execute(
            """
            INSERT INTO bank_connections (id, name, source_type, base_url, openapi_spec, status)
            VALUES ($1, $2, 'openapi', $3, $4, 'connected')
            ON CONFLICT (id) DO UPDATE SET openapi_spec = EXCLUDED.openapi_spec
            """,
            connection_id, name, base_url, spec_text,
        )

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
    await publish_config_update("openapi", connection_id)

    return {
        "status": "registered",
        "connection_id": connection_id,
        "tool_count": len(inserted_tools),
        "tools": inserted_tools,
    }
