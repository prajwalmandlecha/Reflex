"""Policies routes (/api/v1/policies)."""

import json
from fastapi import APIRouter, HTTPException, status
from app.database import get_pool
from app.models.policy import (
    PolicyCreate, PolicyDryRunRequest, PolicyDryRunResult, PolicyResponse,
    PolicyUpdate, PolicyValidateRequest, PolicyValidateResponse,
)
from app.services.config_propagation import cache_active_policies, publish_config_update
from app.services.policy_engine import dry_run_policy, validate_rego

router = APIRouter(prefix="/api/v1/policies", tags=["Policies"])


@router.get("", response_model=list[PolicyResponse])
async def list_policies():
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM policies ORDER BY id ASC")

    res = []
    for r in rows:
        rules = json.loads(r["visual_rules"]) if isinstance(r["visual_rules"], str) else (r["visual_rules"] or [])
        res.append(PolicyResponse(
            id=r["id"],
            name=r["name"],
            scope=r["scope"],
            target_id=r["target_id"],
            type=r["type"],
            version=r["version"],
            rego_source=r["rego_source"],
            visual_rules=rules,
            status=r["status"] or "draft",
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        ))
    return res


@router.post("", response_model=PolicyResponse, status_code=status.HTTP_201_CREATED)
async def create_policy(p: PolicyCreate):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO policies (name, scope, target_id, type, version, rego_source, visual_rules, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
            RETURNING *
            """,
            p.name, p.scope, p.target_id, p.type, p.version, p.rego_source,
            json.dumps(p.visual_rules), p.status,
        )

        # Log policy creation in policy_changelog
        await conn.execute(
            """
            INSERT INTO policy_changelog (policy_id, changed_by, change_type, new_value)
            VALUES ($1, 'operator', 'create', $2::jsonb)
            """,
            row["id"], json.dumps({"name": p.name, "status": p.status, "scope": p.scope}),
        )

    if p.status == "active":
        await cache_active_policies()
        await publish_config_update("policy", str(row["id"]))

    rules = json.loads(row["visual_rules"]) if isinstance(row["visual_rules"], str) else (row["visual_rules"] or [])
    return PolicyResponse(
        id=row["id"], name=row["name"], scope=row["scope"], target_id=row["target_id"],
        type=row["type"], version=row["version"], rego_source=row["rego_source"],
        visual_rules=rules, status=row["status"], created_at=row["created_at"], updated_at=row["updated_at"],
    )


@router.get("/{policy_id}", response_model=PolicyResponse)
async def get_policy(policy_id: int):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM policies WHERE id = $1", policy_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Policy ID {policy_id} not found")

    rules = json.loads(row["visual_rules"]) if isinstance(row["visual_rules"], str) else (row["visual_rules"] or [])
    return PolicyResponse(
        id=row["id"], name=row["name"], scope=row["scope"], target_id=row["target_id"],
        type=row["type"], version=row["version"], rego_source=row["rego_source"],
        visual_rules=rules, status=row["status"], created_at=row["created_at"], updated_at=row["updated_at"],
    )


@router.put("/{policy_id}", response_model=PolicyResponse)
async def update_policy(policy_id: int, p: PolicyUpdate):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM policies WHERE id = $1", policy_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Policy ID {policy_id} not found")

        name = p.name if p.name is not None else row["name"]
        scope = p.scope if p.scope is not None else row["scope"]
        target_id = p.target_id if p.target_id is not None else row["target_id"]
        policy_type = p.type if p.type is not None else row["type"]
        rego_source = p.rego_source if p.rego_source is not None else row["rego_source"]
        visual_rules = json.dumps(p.visual_rules) if p.visual_rules is not None else row["visual_rules"]
        status_val = p.status if p.status is not None else row["status"]
        new_version = row["version"] + 1

        updated = await conn.fetchrow(
            """
            UPDATE policies
            SET name = $1, scope = $2, target_id = $3, type = $4, version = $5,
                rego_source = $6, visual_rules = $7::jsonb, status = $8, updated_at = NOW()
            WHERE id = $9
            RETURNING *
            """,
            name, scope, target_id, policy_type, new_version, rego_source, visual_rules, status_val, policy_id,
        )

        await conn.execute(
            """
            INSERT INTO policy_changelog (policy_id, changed_by, change_type, old_value, new_value)
            VALUES ($1, 'operator', 'update', $2::jsonb, $3::jsonb)
            """,
            policy_id,
            json.dumps({"version": row["version"], "status": row["status"]}),
            json.dumps({"version": new_version, "status": status_val}),
        )

    await cache_active_policies()
    await publish_config_update("policy", str(policy_id))

    rules = json.loads(updated["visual_rules"]) if isinstance(updated["visual_rules"], str) else (updated["visual_rules"] or [])
    return PolicyResponse(
        id=updated["id"], name=updated["name"], scope=updated["scope"], target_id=updated["target_id"],
        type=updated["type"], version=updated["version"], rego_source=updated["rego_source"],
        visual_rules=rules, status=updated["status"], created_at=updated["created_at"], updated_at=updated["updated_at"],
    )


@router.post("/{policy_id}/activate", response_model=PolicyResponse)
async def activate_policy(policy_id: int):
    return await update_policy(policy_id, PolicyUpdate(status="active"))


@router.post("/validate", response_model=PolicyValidateResponse)
async def validate_policy(req: PolicyValidateRequest):
    valid, errors = await validate_rego(req.rego_source)
    return PolicyValidateResponse(valid=valid, errors=errors)


@router.post("/dry-run", response_model=PolicyDryRunResult)
async def dry_run_policy_endpoint(req: PolicyDryRunRequest):
    rego = req.rego_source
    if not rego and req.policy_id:
        pool = get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT rego_source FROM policies WHERE id = $1", req.policy_id)
            if row:
                rego = row["rego_source"]

    if not rego:
        raise HTTPException(status_code=400, detail="Missing 'rego_source' or valid 'policy_id'")

    res = await dry_run_policy(rego, req.sample_size)
    return PolicyDryRunResult(**res)
