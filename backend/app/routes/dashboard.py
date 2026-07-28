"""Dashboard summary and activity feed routes (/api/v1/dashboard)."""

import json
from fastapi import APIRouter
from app.database import get_pool
from app.event_processor import event_processor

router = APIRouter(prefix="/api/v1/dashboard", tags=["Dashboard"])


@router.get("/summary")
async def get_dashboard_summary():
    pool = get_pool()
    async with pool.acquire() as conn:
        total_agents = await conn.fetchval("SELECT COUNT(*) FROM agent_instances")
        active_agents = await conn.fetchval("SELECT COUNT(*) FROM agent_instances WHERE status = 'active'")
        revoked_agents = await conn.fetchval("SELECT COUNT(*) FROM agent_instances WHERE status = 'revoked'")

        total_classes = await conn.fetchval("SELECT COUNT(*) FROM agent_classes")
        total_connections = await conn.fetchval("SELECT COUNT(*) FROM bank_connections")
        total_policies = await conn.fetchval("SELECT COUNT(*) FROM policies WHERE status = 'active'")

        # Denials in last hour
        denials_last_hour = await conn.fetchval(
            "SELECT COUNT(*) FROM audit_log WHERE decision = 'deny' AND ts >= NOW() - INTERVAL '1 hour'"
        )

        # Spend today (only allowed requests count toward spend)
        spend_today_cents = await conn.fetchval(
            "SELECT COALESCE(SUM(spend_delta), 0) FROM audit_log WHERE ts >= CURRENT_DATE AND decision = 'allow'"
        )

    metrics_snap = {}
    try:
        if event_processor:
            metrics_snap = event_processor.metrics_buffer.snapshot()
    except Exception:
        metrics_snap = {}

    spend_val = float(spend_today_cents) if spend_today_cents is not None else 0.0

    return {
        "agents": {
            "total": total_agents or 0,
            "active": active_agents or 0,
            "revoked": revoked_agents or 0,
        },
        "classes_count": total_classes or 0,
        "connections_count": total_connections or 0,
        "active_policies_count": total_policies or 0,
        "denials_last_hour": denials_last_hour or 0,
        "spend_today_usd": spend_val / 100.0,
        "recent_metrics": metrics_snap,
    }


@router.get("/activity")
async def get_recent_activity(limit: int = 50):
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, ts, agent_id, agent_class_id, action, params, decision, deny_stage, reason,
                   spend_delta, total_latency_ms, governance_overhead_ms, bank_connection_id
            FROM audit_log
            ORDER BY id DESC
            LIMIT $1
            """,
            limit,
        )

    res = []
    for r in rows:
        p = json.loads(r["params"]) if isinstance(r["params"], str) else (r["params"] or {})
        res.append({
            "id": str(r["id"]),
            "timestamp": r["ts"].isoformat(),
            "agent_id": r["agent_id"],
            "agentId": r["agent_id"],
            "agent_class_id": r["agent_class_id"],
            "agentClass": r["agent_class_id"],
            "action": r["action"],
            "tool": r["action"],
            "bank_connection_id": r["bank_connection_id"] or "",
            "bankConnectionId": r["bank_connection_id"] or "",
            "params": p,
            "decision": r["decision"],
            "deny_stage": r["deny_stage"] or "",
            "reason": r["reason"] or "",
            "spend_delta_cents": r["spend_delta"] or 0,
            "total_latency_ms": r["total_latency_ms"] or 0.0,
            "latencyMs": r["total_latency_ms"] or 0.0,
            "governance_overhead_ms": r["governance_overhead_ms"] or 0.0,
        })
    return res

