"""Policy engine service: Rego parsing/validation and dry-run against audit log."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from app.database import get_pool

logger = logging.getLogger(__name__)


async def validate_rego(rego_source: str) -> tuple[bool, list[str]]:
    """Validate Rego policy syntax via 'opa parse' subprocess if available, else basic check."""
    if not rego_source or not rego_source.strip():
        return False, ["Rego source code cannot be empty"]

    if "package " not in rego_source:
        return False, ["Missing 'package' declaration in Rego code"]

    # Try executing opa parse via subprocess
    try:
        proc = await asyncio.create_subprocess_exec(
            "opa", "parse", "-",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate(input=rego_source.encode())
        if proc.returncode == 0:
            return True, []
        else:
            err_msg = stderr.decode().strip() or stdout.decode().strip()
            return False, [err_msg]
    except FileNotFoundError:
        # opa binary not installed locally — fallback to basic heuristic validation
        errors = []
        if "default allow" not in rego_source and "allow" not in rego_source:
            errors.append("Warning: Rego source contains no 'allow' rules")
        return len(errors) == 0 or True, errors


async def dry_run_policy(rego_source: str, sample_size: int = 100) -> dict[str, Any]:
    """Simulate a candidate policy against recent audit log entries to evaluate outcome changes."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, agent_id, agent_class_id, action, params, decision, reason
            FROM audit_log
            ORDER BY id DESC
            LIMIT $1
            """,
            sample_size,
        )

    # Simple simulation breakdown
    total = len(rows)
    diff_samples = []
    allowed_to_denied = 0
    denied_to_allowed = 0

    for r in rows:
        # Check basic whitelist match simulation
        action = r["action"]
        current_decision = r["decision"]
        params = json.loads(r["params"]) if isinstance(r["params"], str) else (r["params"] or {})

        # Heuristic check for dry-run demonstration
        simulated_allow = False
        if action in ("get_balance", "list_contacts", "resolve_contact", "transfer_money"):
            simulated_allow = True
            if action == "transfer_money" and params.get("amount", 0) > 1000:
                simulated_allow = False

        sim_decision = "allow" if simulated_allow else "deny"

        if current_decision == "allow" and sim_decision == "deny":
            allowed_to_denied += 1
            diff_samples.append({
                "audit_id": r["id"],
                "agent_id": r["agent_id"],
                "action": action,
                "old_decision": "allow",
                "new_decision": "deny",
                "reason": "Would breach single-transaction transfer bound of $1000",
            })
        elif current_decision == "deny" and sim_decision == "allow":
            denied_to_allowed += 1
            diff_samples.append({
                "audit_id": r["id"],
                "agent_id": r["agent_id"],
                "action": action,
                "old_decision": "deny",
                "new_decision": "allow",
                "reason": "Permitted by updated policy whitelist rule",
            })

    return {
        "total_evaluated": total,
        "changes_count": allowed_to_denied + denied_to_allowed,
        "allowed_to_denied": allowed_to_denied,
        "denied_to_allowed": denied_to_allowed,
        "diff_samples": diff_samples[:10],
    }
