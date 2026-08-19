"""Pydantic models for Bank Connections."""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class BankConnectionBase(BaseModel):
    # id is optional on create — derived from `name` (slugified) when omitted.
    id: str | None = None
    name: str
    source_type: str  # 'native_mcp', 'openapi', 'manual'
    mcp_url: str | None = None
    base_url: str | None = None
    openapi_spec: str | None = None
    credential_type: str | None = None
    sensitive_response: bool = False  # suppress response body in audit/events


class BankConnectionCreate(BankConnectionBase):
    # NOTE: status is intentionally absent — it is derived server-side from a
    # real discovery probe, never asserted by the client.
    credentials: str | None = None  # raw secret, encrypted before storage


class BankConnectionUpdate(BaseModel):
    name: str | None = None
    mcp_url: str | None = None
    base_url: str | None = None
    openapi_spec: str | None = None
    credential_type: str | None = None
    credentials: str | None = None
    status: str | None = None
    sensitive_response: bool | None = None


class BankConnectionResponse(BankConnectionBase):
    status: str = "pending"  # connected / error / pending — derived from discovery
    created_at: datetime
    updated_at: datetime
    tool_count: int = 0
    tools: list[dict[str, Any]] = Field(default_factory=list)
    resource_count: int = 0
    resources: list[dict[str, Any]] = Field(default_factory=list)
    prompt_count: int = 0
    prompts: list[dict[str, Any]] = Field(default_factory=list)
