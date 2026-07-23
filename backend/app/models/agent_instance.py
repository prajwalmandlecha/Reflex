"""Pydantic models for Agent Instances."""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class AgentInstanceBase(BaseModel):
    id: str
    class_id: str
    status: str = "active"
    constraint_overrides: dict[str, Any] = Field(default_factory=dict)
    cap_overrides: dict[str, Any] = Field(default_factory=dict)
    tool_overrides: list[str] | None = None


class AgentInstanceCreate(AgentInstanceBase):
    pass


class AgentInstanceUpdate(BaseModel):
    class_id: str | None = None
    status: str | None = None
    constraint_overrides: dict[str, Any] | None = None
    cap_overrides: dict[str, Any] | None = None
    tool_overrides: list[str] | None = None


class AgentInstanceResponse(AgentInstanceBase):
    created_at: datetime
    updated_at: datetime
    spend_today: float = 0.0
    cap_today: float = 0.0
    last_action: str = ""
    last_seen: str = ""
    class_name: str = ""
    jwt_token: str | None = None
