"""Audit Log routes (/api/v1/audit)."""

import json
from fastapi import APIRouter, Query
from fastapi.responses import PlainTextResponse
from app.database import get_pool
from app.models.audit import AuditLogResponse, AuditVerificationResult

router = APIRouter(prefix="/api/v1/audit", tags=["Audit Log"])


@router.get("", response_model=list[AuditLogResponse])
async def list_audit_log(
    agent_id: str | None = Query(None),
    agent_class_id: str | None = Query(None),
    action: str | None = Query(None),
    decision: str | None = Query(None),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    pool = get_pool()
    query = "SELECT * FROM audit_log WHERE 1=1"
    params = []
    idx = 1

    if agent_id:
        query += f" AND agent_id = ${idx}"
        params.append(agent_id)
        idx += 1
    if agent_class_id:
        query += f" AND agent_class_id = ${idx}"
        params.append(agent_class_id)
        idx += 1
    if action:
        query += f" AND action = ${idx}"
        params.append(action)
        idx += 1
    if decision:
        query += f" AND decision = ${idx}"
        params.append(decision)
        idx += 1

    query += f" ORDER BY id DESC LIMIT ${idx} OFFSET ${idx+1}"
    params.extend([limit, offset])

    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)

    res = []
    for r in rows:
        p = json.loads(r["params"]) if isinstance(r["params"], str) else (r["params"] or {})
        res.append(AuditLogResponse(
            id=r["id"],
            ts=r["ts"],
            agent_id=r["agent_id"],
            agent_class_id=r["agent_class_id"] or "",
            action=r["action"],
            bank_connection_id=r["bank_connection_id"] or "",
            params=p,
            decision=r["decision"],
            deny_stage=r["deny_stage"] or "",
            reason=r["reason"] or "",
            spend_delta=r["spend_delta"] or 0,
            total_latency_ms=r["total_latency_ms"] or 0.0,
            killswitch_latency_ms=r["killswitch_latency_ms"] or 0.0,
            policy_latency_ms=r["policy_latency_ms"] or 0.0,
            spend_check_latency_ms=r["spend_check_latency_ms"] or 0.0,
            constraint_latency_ms=r["constraint_latency_ms"] or 0.0,
            downstream_latency_ms=r["downstream_latency_ms"] or 0.0,
            governance_overhead_ms=r["governance_overhead_ms"] or 0.0,
            prev_hash=r["prev_hash"] or "",
            entry_hash=r["entry_hash"] or "",
        ))
    return res


@router.get("/verify", response_model=AuditVerificationResult)
async def verify_audit_log_integrity():
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, ts, agent_id, agent_class_id, action, decision, deny_stage, spend_delta, governance_overhead_ms, reason, prev_hash, entry_hash
            FROM audit_log
            ORDER BY id ASC
            """
        )

    if not rows:
        return AuditVerificationResult(valid=True, total_records=0, verified_until_id=0)

    prev_hash = ""
    for r in rows:
        if r["prev_hash"] != prev_hash:
            return AuditVerificationResult(
                valid=False,
                total_records=len(rows),
                verified_until_id=r["id"] - 1,
                error_message=f"Hash chain mismatch at row ID {r['id']}: expected prev_hash '{prev_hash}', got '{r['prev_hash']}'",
            )
        prev_hash = r["entry_hash"]

    return AuditVerificationResult(
        valid=True,
        total_records=len(rows),
        verified_until_id=rows[-1]["id"],
    )


@router.get("/export")
async def export_audit_log(format: str = "csv"):
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM audit_log ORDER BY id ASC LIMIT 5000")

    if format == "csv":
        lines = ["id,timestamp,agent_id,action,decision,deny_stage,reason,spend_delta_cents,total_latency_ms,governance_overhead_ms,entry_hash"]
        for r in rows:
            lines.append(f"{r['id']},{r['ts'].isoformat()},{r['agent_id']},{r['action']},{r['decision']},{r['deny_stage']},{r['reason']},{r['spend_delta']},{r['total_latency_ms']},{r['governance_overhead_ms']},{r['entry_hash']}")
        return PlainTextResponse("\n".join(lines), media_type="text/csv")

    return [dict(r) for r in rows]
