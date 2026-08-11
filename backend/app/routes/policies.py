"""Policies routes (/api/v1/policies)."""

import json
from fastapi import APIRouter, Depends, HTTPException, status
from app.auth import get_current_user, log_system_action, require_permission
from app.database import get_pool
from typing import Any
from app.models.policy import (
    PolicyCreate, PolicyResponse,
    PolicyUpdate, PolicyValidateRequest, PolicyValidateResponse,
    PolicyTestInputRequest, PolicyTestInputResponse,
    PolicyDryRunRequest, PolicyDryRunResult,
)
from app.services.config_propagation import cache_active_policies, publish_config_update
from app.services.policy_engine import validate_rego, evaluate_rego_testcase, visual_rules_to_rego

router = APIRouter(prefix="/api/v1/policies", tags=["Policies"])


@router.get("", response_model=list[PolicyResponse])
async def list_policies(current_user: dict = Depends(get_current_user)):
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


# NOTE: registered BEFORE /{policy_id} so FastAPI doesn't capture "changelog"
# as an integer policy_id (routes match in registration order).
@router.get("/changelog")
async def get_policy_changelog(policy_id: int | None = None, limit: int = 100, current_user: dict = Depends(get_current_user)):
    """Expose the policy_changelog audit trail (written on every mutation but
    previously never readable)."""
    pool = get_pool()
    async with pool.acquire() as conn:
        if policy_id is not None:
            rows = await conn.fetch(
                "SELECT * FROM policy_changelog WHERE policy_id = $1 ORDER BY changed_at DESC LIMIT $2",
                policy_id, limit,
            )
        else:
            rows = await conn.fetch(
                "SELECT * FROM policy_changelog ORDER BY changed_at DESC LIMIT $1",
                limit,
            )
    return [
        {
            "id": r["id"],
            "policy_id": r["policy_id"],
            "changed_by": r["changed_by"],
            "change_type": r["change_type"],
            "old_value": json.loads(r["old_value"]) if isinstance(r["old_value"], str) else r["old_value"],
            "new_value": json.loads(r["new_value"]) if isinstance(r["new_value"], str) else r["new_value"],
            "changed_at": r["changed_at"].isoformat() if r["changed_at"] else "",
        }
        for r in rows
    ]


@router.post("", response_model=PolicyResponse, status_code=status.HTTP_201_CREATED)
async def create_policy(p: PolicyCreate, current_user: dict = Depends(require_permission("policies:create"))):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO policies (name, scope, target_id, type, version, rego_source, visual_rules, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
            ON CONFLICT (name, scope, COALESCE(target_id, '__global__')) DO UPDATE SET
                type = EXCLUDED.type,
                version = policies.version + 1,
                rego_source = EXCLUDED.rego_source,
                visual_rules = EXCLUDED.visual_rules,
                status = EXCLUDED.status,
                updated_at = NOW()
            RETURNING *
            """,
            p.name, p.scope, p.target_id, p.type, p.version, p.rego_source,
            json.dumps(p.visual_rules), p.status,
        )

        # Log policy creation in policy_changelog & system audit log
        await conn.execute(
            """
            INSERT INTO policy_changelog (policy_id, changed_by, change_type, new_value)
            VALUES ($1, $2, 'create', $3::jsonb)
            """,
            row["id"], current_user.get("email", "operator"), json.dumps({"name": p.name, "status": p.status, "scope": p.scope}),
        )

    await log_system_action(current_user, "policy_created", str(row["id"]), p.name, {"scope": p.scope, "type": p.type, "status": p.status})

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
async def get_policy(policy_id: int, current_user: dict = Depends(get_current_user)):
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
async def update_policy(policy_id: int, p: PolicyUpdate, current_user: dict = Depends(require_permission("policies:update"))):
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
            VALUES ($1, $2, 'update', $3::jsonb, $4::jsonb)
            """,
            policy_id,
            current_user.get("email", "operator"),
            json.dumps({"version": row["version"], "status": row["status"]}),
            json.dumps({"version": new_version, "status": status_val}),
        )

    await log_system_action(current_user, "policy_updated", str(policy_id), name, {"version": new_version, "status": status_val})

    await cache_active_policies()
    await publish_config_update("policy", str(policy_id))

    rules = json.loads(updated["visual_rules"]) if isinstance(updated["visual_rules"], str) else (updated["visual_rules"] or [])
    return PolicyResponse(
        id=updated["id"], name=updated["name"], scope=updated["scope"], target_id=updated["target_id"],
        type=updated["type"], version=updated["version"], rego_source=updated["rego_source"],
        visual_rules=rules, status=updated["status"], created_at=updated["created_at"], updated_at=updated["updated_at"],
    )


@router.post("/{policy_id}/activate", response_model=PolicyResponse)
async def activate_policy(policy_id: int, current_user: dict = Depends(require_permission("policies:update"))):
    return await update_policy(policy_id, PolicyUpdate(status="active"))


@router.delete("/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_policy(policy_id: int, current_user: dict = Depends(require_permission("policies:archive"))):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM policies WHERE id = $1", policy_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Policy ID {policy_id} not found")

        await conn.execute("DELETE FROM policies WHERE id = $1", policy_id)

        await conn.execute(
            """
            INSERT INTO policy_changelog (policy_id, changed_by, change_type, old_value)
            VALUES ($1, $2, 'delete', $3::jsonb)
            """,
            None, current_user.get("email", "operator"), json.dumps({"id": policy_id, "name": row["name"], "status": row["status"]}),
        )

    await log_system_action(current_user, "policy_deleted", str(policy_id), row["name"])

    await cache_active_policies()
    await publish_config_update("policy", str(policy_id))


@router.post("/validate", response_model=PolicyValidateResponse)
async def validate_policy(req: PolicyValidateRequest, current_user: dict = Depends(get_current_user)):
    valid, errors = await validate_rego(req.rego_source)
    return PolicyValidateResponse(valid=valid, errors=errors)


@router.post("/compile-visual")
async def compile_visual_rules(payload: dict[str, Any], current_user: dict = Depends(get_current_user)):
    rules = payload.get("rules", []) if isinstance(payload, dict) and "rules" in payload else (payload if isinstance(payload, list) else [])
    target_id = payload.get("target_id") if isinstance(payload, dict) else None
    scope = payload.get("scope", "global") if isinstance(payload, dict) else "global"
    rego_code = visual_rules_to_rego(rules, target_id=target_id, scope=scope)
    return {"rego_source": rego_code}


@router.post("/test-input", response_model=PolicyTestInputResponse)
async def test_policy_input(req: PolicyTestInputRequest, current_user: dict = Depends(get_current_user)):
    res = await evaluate_rego_testcase(req.rego_source, req.visual_rules, req.input_payload)
    return PolicyTestInputResponse(**res)


@router.post("/dry-run", response_model=PolicyDryRunResult)
async def dry_run_policy(req: PolicyDryRunRequest, current_user: dict = Depends(get_current_user)):
    """Evaluate a candidate policy against recent audit-log decisions to show what
    WOULD change if it were activated — without touching the live policy set.

    Compares the candidate's decision against the recorded actual decision for
    each sampled audit row and reports the flip counts."""
    # Resolve the candidate Rego source.
    rego_source = req.rego_source
    pool = get_pool()
    if not rego_source and req.policy_id is not None:
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT rego_source FROM policies WHERE id = $1", req.policy_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Policy ID {req.policy_id} not found")
        rego_source = row["rego_source"]
    if not rego_source:
        raise HTTPException(status_code=400, detail="Provide rego_source or policy_id")

    # Sample recent audit rows that carry enough context to re-evaluate.
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT agent_id, agent_class_id, action, params, decision
            FROM audit_log
            ORDER BY id DESC
            LIMIT $1
            """,
            req.sample_size,
        )

    total = 0
    allow_to_deny = 0
    deny_to_allow = 0
    samples: list[dict[str, Any]] = []

    for r in rows:
        params = json.loads(r["params"]) if isinstance(r["params"], str) else (r["params"] or {})
        input_payload = {
            "agent_id": r["agent_id"],
            "agent_kind": r["agent_class_id"],
            "action": r["action"],
            "params": params,
            "amount": params.get("amount", 0) if isinstance(params, dict) else 0,
        }
        try:
            res = await evaluate_rego_testcase(rego_source, None, input_payload)
        except Exception:
            continue  # skip rows the candidate can't evaluate

        candidate_allow = bool(res.get("allow", False))
        actual_allow = r["decision"] == "allow"
        total += 1

        if actual_allow and not candidate_allow:
            allow_to_deny += 1
        elif not actual_allow and candidate_allow:
            deny_to_allow += 1
        else:
            continue  # no change

        if len(samples) < 20:
            samples.append({
                "agent_id": r["agent_id"],
                "action": r["action"],
                "actual": "allow" if actual_allow else "deny",
                "candidate": "allow" if candidate_allow else "deny",
            })

    return PolicyDryRunResult(
        total_evaluated=total,
        changes_count=allow_to_deny + deny_to_allow,
        allowed_to_denied=allow_to_deny,
        denied_to_allowed=deny_to_allow,
        diff_samples=samples,
    )


