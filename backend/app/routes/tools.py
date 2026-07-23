"""Tools routes (/api/v1/tools)."""

import json
from fastapi import APIRouter, HTTPException
from app.database import get_pool
from app.models.tool import ToolResponse, ToolUpdate

router = APIRouter(prefix="/api/v1/tools", tags=["Tools"])


@router.get("", response_model=list[ToolResponse])
async def list_tools(bank_connection_id: str | None = None):
    pool = get_pool()
    async with pool.acquire() as conn:
        if bank_connection_id:
            rows = await conn.fetch("SELECT * FROM tools WHERE bank_connection_id = $1 ORDER BY name ASC", bank_connection_id)
        else:
            rows = await conn.fetch("SELECT * FROM tools ORDER BY name ASC")

    res = []
    for r in rows:
        schema = json.loads(r["input_schema"]) if isinstance(r["input_schema"], str) else (r["input_schema"] or {})
        ops = json.loads(r["underlying_ops"]) if isinstance(r["underlying_ops"], str) else (r["underlying_ops"] or [])
        res.append(ToolResponse(
            id=r["id"],
            bank_connection_id=r["bank_connection_id"],
            name=r["name"],
            description=r["description"] or "",
            input_schema=schema,
            underlying_ops=ops,
            exposed=r["exposed"],
            created_at=r["created_at"],
        ))
    return res


@router.put("/{tool_id}", response_model=ToolResponse)
async def update_tool(tool_id: int, tool_update: ToolUpdate):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM tools WHERE id = $1", tool_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Tool ID {tool_id} not found")

        name = tool_update.name if tool_update.name is not None else row["name"]
        description = tool_update.description if tool_update.description is not None else row["description"]
        exposed = tool_update.exposed if tool_update.exposed is not None else row["exposed"]

        updated = await conn.fetchrow(
            """
            UPDATE tools
            SET name = $1, description = $2, exposed = $3
            WHERE id = $4
            RETURNING *
            """,
            name, description, exposed, tool_id,
        )

    schema = json.loads(updated["input_schema"]) if isinstance(updated["input_schema"], str) else (updated["input_schema"] or {})
    ops = json.loads(updated["underlying_ops"]) if isinstance(updated["underlying_ops"], str) else (updated["underlying_ops"] or [])
    return ToolResponse(
        id=updated["id"],
        bank_connection_id=updated["bank_connection_id"],
        name=updated["name"],
        description=updated["description"] or "",
        input_schema=schema,
        underlying_ops=ops,
        exposed=updated["exposed"],
        created_at=updated["created_at"],
    )
