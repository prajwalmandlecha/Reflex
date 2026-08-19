"""Pydantic models for Tools."""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class ToolBase(BaseModel):
    bank_connection_id: str
    name: str
    description: str = ""
    input_schema: dict[str, Any] = Field(default_factory=dict)
    underlying_ops: list[dict[str, Any]] = Field(default_factory=list)
    exposed: bool = True
    sensitive_response: bool = False


class ToolCreate(ToolBase):
    pass


class ToolUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    input_schema: dict[str, Any] | None = None
    underlying_ops: list[dict[str, Any]] | None = None
    exposed: bool | None = None
    sensitive_response: bool | None = None


class ToolResponse(ToolBase):
    id: int
    created_at: datetime
