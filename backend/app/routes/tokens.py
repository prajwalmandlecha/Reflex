"""JWT Minting routes (/api/v1/tokens)."""

import datetime
from fastapi import APIRouter, Body, Depends, HTTPException
import jwt
from app.auth import log_system_action, require_permission
from app.config import settings

router = APIRouter(prefix="/api/v1/tokens", tags=["Tokens"], redirect_slashes=False)


def create_agent_jwt(agent_id: str, agent_kind: str = "custom", policy_version: int = 1) -> str:
    """Mint a signed JWT for an agent identity using HMAC-SHA256 and the shared JWT_SECRET."""
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "iss": settings.jwt_issuer,
        "sub": agent_id,
        "iat": now,
        "exp": now + datetime.timedelta(minutes=settings.jwt_ttl_minutes),
        "agent_id": agent_id,
        "agent_kind": agent_kind,
        "policy_version": policy_version,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


@router.post("")
@router.post("/")
async def mint_token(
    payload: dict = Body(default={}),
    agent_id: str | None = None,
    agent_kind: str | None = None,
    policy_version: int | None = None,
    current_user: dict = Depends(require_permission("instances:mint_token")),
):
    """Mint an agent JWT.

    Accepts EITHER a JSON body ({"agent_id": ..., "agent_kind": ..., "policy_version": ...})
    OR query parameters (?agent_id=...&agent_kind=...). Body values take precedence.
    agent_id is required (from either source); agent_kind defaults to "custom",
    policy_version to 1."""
    resolved_id = payload.get("agent_id") or agent_id
    if not resolved_id:
        raise HTTPException(status_code=400, detail="agent_id is required (JSON body or query parameter)")
    resolved_kind = payload.get("agent_kind") or agent_kind or "custom"
    resolved_version = int(payload.get("policy_version") or policy_version or 1)

    token = create_agent_jwt(resolved_id, resolved_kind, resolved_version)
    await log_system_action(current_user, "token_minted", resolved_id, resolved_kind)
    return {"token": token, "agent_id": resolved_id, "expires_in_minutes": settings.jwt_ttl_minutes}
