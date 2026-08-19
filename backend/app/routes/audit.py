import csv
import datetime
import hashlib
import io
import json
from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from app.auth import require_permission
from app.database import get_pool
from app.models.audit import AuditLogResponse, AuditVerificationResult


def _go_rfc3339nano(ts: datetime.datetime) -> str:
    """Format a UTC datetime exactly as Go's encoding/json marshals time.Time
    (RFC3339Nano): 'Z' suffix, fractional seconds present only when non-zero,
    trailing zeros trimmed. Must match the gateway's hash input byte-for-byte."""
    base = ts.strftime("%Y-%m-%dT%H:%M:%S")
    micro = ts.microsecond
    if micro:
        frac = f"{micro:06d}".rstrip("0")
        return f"{base}.{frac}Z"
    return f"{base}Z"


def _compute_entry_hash(prev_hash: str, row) -> str:
    """Recompute the gateway's SHA-256 entry hash for a stored row.

    Must mirror the field set and canonical JSON layout of the gateway's
    hashContent struct (internal/audit/logger.go) exactly, or verification
    false-positives. Timestamp is normalized to UTC with microsecond precision
    to match the gateway's Truncate(time.Microsecond).UTC()."""
    ts = row["ts"]
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=datetime.timezone.utc)
    ts = ts.astimezone(datetime.timezone.utc)
    content = {
        "ts": _go_rfc3339nano(ts),
        "agent_id": row["agent_id"],
        "agent_class_id": row["agent_class_id"] or "",
        "action": row["action"],
        "decision": row["decision"],
        "deny_stage": row["deny_stage"] or "",
        "governance_overhead_ms": row["governance_overhead_ms"] or 0.0,
        "reason": row["reason"] or "",
    }
    payload = json.dumps(content, separators=(",", ":"), ensure_ascii=False)
    h = hashlib.sha256()
    h.update(prev_hash.encode())
    h.update(payload.encode())
    return h.hexdigest()

router = APIRouter(prefix="/api/v1/audit", tags=["Audit Log"])


@router.get("", response_model=list[AuditLogResponse])
async def list_audit_log(
    agent_id: str | None = Query(None),
    agent_class_id: str | None = Query(None),
    action: str | None = Query(None),
    decision: str | None = Query(None),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("audit:read")),
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
async def verify_audit_log_integrity(current_user: dict = Depends(require_permission("audit:verify"))):
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, ts, agent_id, agent_class_id, action, decision, deny_stage, governance_overhead_ms, reason, prev_hash, entry_hash
            FROM audit_log
            ORDER BY id ASC
            """
        )

    if not rows:
        return AuditVerificationResult(valid=True, total_records=0, verified_until_id=0)

    prev_hash = ""
    last_good_id = 0
    for r in rows:
        row_prev_hash = r["prev_hash"] or ""
        # 1. Linkage: this row must chain to the previous row's entry_hash.
        if row_prev_hash != prev_hash:
            return AuditVerificationResult(
                valid=False,
                total_records=len(rows),
                verified_until_id=last_good_id,
                error_message=f"Hash chain mismatch at row ID {r['id']}: expected prev_hash '{prev_hash}', got '{r['prev_hash']}'",
            )
        # 2. Content integrity: recompute the hash from the stored fields so a
        # row whose content was edited (while keeping both hashes) is caught.
        recomputed = _compute_entry_hash(prev_hash, r)
        if recomputed != r["entry_hash"]:
            return AuditVerificationResult(
                valid=False,
                total_records=len(rows),
                verified_until_id=last_good_id,
                error_message=f"Content hash mismatch at row ID {r['id']}: stored entry_hash does not match recomputed content hash",
            )
        prev_hash = r["entry_hash"]
        last_good_id = r["id"]

    return AuditVerificationResult(
        valid=True,
        total_records=len(rows),
        verified_until_id=last_good_id,
    )


@router.get("/export")
async def export_audit_log(format: str = "csv", current_user: dict = Depends(require_permission("audit:export"))):
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM audit_log ORDER BY id ASC LIMIT 5000")

    if format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["id", "timestamp", "agent_id", "action", "decision", "deny_stage", "reason", "total_latency_ms", "governance_overhead_ms", "entry_hash"])
        for r in rows:
            writer.writerow([
                r["id"], r["ts"].isoformat(), r["agent_id"], r["action"], r["decision"],
                r["deny_stage"], r["reason"], r["total_latency_ms"],
                r["governance_overhead_ms"], r["entry_hash"],
            ])
        return PlainTextResponse(
            buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=audit_log.csv"},
        )

    return [dict(r) for r in rows]


@router.get("/system-log")
async def list_system_audit_log(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_permission("audit:read")),
):
    """Retrieve system, administrative, governance, policy, fleet, and connection operation logs."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, actor_id, actor_email, action, target_user_id, target_email, details, created_at
            FROM user_audit_log
            ORDER BY id DESC
            LIMIT $1 OFFSET $2
            """,
            limit, offset
        )
    return [
        {
            "id": r["id"],
            "actor_id": r["actor_id"],
            "actor_email": r["actor_email"],
            "action": r["action"],
            "target_id": r["target_user_id"],
            "target_email": r["target_email"],
            "details": json.loads(r["details"]) if isinstance(r["details"], str) else (r["details"] or {}),
            "created_at": r["created_at"].isoformat() if r["created_at"] else "",
        }
        for r in rows
    ]
