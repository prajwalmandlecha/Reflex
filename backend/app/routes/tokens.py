"""JWT Minting routes (/api/v1/tokens)."""

import datetime
from fastapi import APIRouter, HTTPException
import jwt
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
async def mint_token(agent_id: str, agent_kind: str = "custom", policy_version: int = 1):
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id query parameter is required")

    token = create_agent_jwt(agent_id, agent_kind, policy_version)
    return {"token": token, "agent_id": agent_id, "expires_in_minutes": settings.jwt_ttl_minutes}
