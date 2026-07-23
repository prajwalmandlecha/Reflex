"""Pydantic models for Agent Classes."""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class AgentClassBase(BaseModel):
    id: str
    name: str
    description: str = ""
    default_allowed_tools: list[str] = Field(default_factory=list)
    default_constraints: dict[str, Any] = Field(default_factory=dict)
    default_caps: dict[str, Any] = Field(default_factory=dict)
    status: str = "active"


class AgentClassCreate(AgentClassBase):
    pass


class AgentClassUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    default_allowed_tools: list[str] | None = None
    default_constraints: dict[str, Any] | None = None
    default_caps: dict[str, Any] | None = None
    status: str | None = None


class AgentClassResponse(AgentClassBase):
    created_at: datetime
    updated_at: datetime
    instance_count: int = 0
