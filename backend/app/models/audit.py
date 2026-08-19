"""Pydantic models for Audit Log and Activity."""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class LatencyBreakdown(BaseModel):
    total_ms: float = 0.0
    killswitch_ms: float = 0.0
    policy_ms: float = 0.0
    spend_check_ms: float = 0.0
    constraint_ms: float = 0.0
    downstream_ms: float = 0.0
    governance_overhead_ms: float = 0.0


class AuditLogResponse(BaseModel):
    id: int
    ts: datetime
    agent_id: str
    agent_class_id: str = ""
    action: str
    bank_connection_id: str = ""
    params: dict[str, Any] = Field(default_factory=dict)
    decision: str  # 'allow', 'deny'
    deny_stage: str = ""
    reason: str = ""
    total_latency_ms: float = 0.0
    killswitch_latency_ms: float = 0.0
    policy_latency_ms: float = 0.0
    spend_check_latency_ms: float = 0.0
    constraint_latency_ms: float = 0.0
    downstream_latency_ms: float = 0.0
    governance_overhead_ms: float = 0.0
    prev_hash: str = ""
    entry_hash: str = ""


class AuditVerificationResult(BaseModel):
    valid: bool
    total_records: int
    verified_until_id: int
    error_message: str | None = None
