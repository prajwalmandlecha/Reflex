"""Pydantic models for Policies."""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class PolicyBase(BaseModel):
    name: str
    scope: str = "global"  # 'global', 'class', 'instance'
    target_id: str | None = None
    type: str = "rego"  # 'rego', 'visual'
    version: int = 1
    rego_source: str | None = None
    visual_rules: list[dict[str, Any]] = Field(default_factory=list)
    status: str = "draft"  # 'draft', 'active', 'archived'


class PolicyCreate(PolicyBase):
    pass


class PolicyUpdate(BaseModel):
    name: str | None = None
    scope: str | None = None
    target_id: str | None = None
    type: str | None = None
    rego_source: str | None = None
    visual_rules: list[dict[str, Any]] | None = None
    status: str | None = None


class PolicyResponse(PolicyBase):
    id: int
    created_at: datetime
    updated_at: datetime


class PolicyValidateRequest(BaseModel):
    rego_source: str


class PolicyValidateResponse(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)


class PolicyDryRunRequest(BaseModel):
    policy_id: int | None = None
    rego_source: str | None = None
    sample_size: int = 100


class PolicyDryRunResult(BaseModel):
    total_evaluated: int
    changes_count: int
    allowed_to_denied: int
    denied_to_allowed: int
    diff_samples: list[dict[str, Any]] = Field(default_factory=list)


class PolicyTestInputRequest(BaseModel):
    rego_source: str | None = None
    visual_rules: list[dict[str, Any]] | None = None
    input_payload: dict[str, Any]


class PolicyTestInputResponse(BaseModel):
    allowed: bool
    decision: str  # 'ALLOW' or 'DENY'
    reasons: list[str] = Field(default_factory=list)
    rego_source: str

