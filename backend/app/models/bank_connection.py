"""Pydantic models for Bank Connections."""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class BankConnectionBase(BaseModel):
    id: str
    name: str
    source_type: str  # 'native_mcp', 'openapi', 'manual'
    mcp_url: str | None = None
    base_url: str | None = None
    openapi_spec: str | None = None
    credential_type: str | None = None
    status: str = "connected"


class BankConnectionCreate(BankConnectionBase):
    credentials: str | None = None  # raw secret, encrypted before storage


class BankConnectionUpdate(BaseModel):
    name: str | None = None
    mcp_url: str | None = None
    base_url: str | None = None
    openapi_spec: str | None = None
    credential_type: str | None = None
    credentials: str | None = None
    status: str | None = None


class BankConnectionResponse(BankConnectionBase):
    created_at: datetime
    updated_at: datetime
    tool_count: int = 0
    tools: list[dict[str, Any]] = Field(default_factory=list)
