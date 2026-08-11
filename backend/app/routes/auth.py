"""Authentication & Session routes (/api/v1/auth)."""

import datetime
import uuid
from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.auth import (
    ROLE_PERMISSIONS, create_user_token, get_current_user,
    hash_password, log_system_action, verify_password,
)
from app.database import get_pool

router = APIRouter(prefix="/api/v1/auth", tags=["Auth"], redirect_slashes=False)


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.post("/login")
async def login(req: LoginRequest, request: Request):
    """Authenticate user credentials and return session token."""
    pool = get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, email, full_name, password_hash, role, status, must_change_password FROM users WHERE email = $1",
            req.email.lower()
        )
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )
        if user["status"] != "active":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is suspended. Please contact your system administrator."
            )

        # Update last_login_at timestamp
        now = datetime.datetime.now(datetime.timezone.utc)
        await conn.execute(
            "UPDATE users SET last_login_at = $1 WHERE id = $2", now, user["id"]
        )

        # Mint session token
        token_data = create_user_token(
            user_id=user["id"],
            email=user["email"],
            role=user["role"],
            full_name=user["full_name"]
        )

        # Record active session in DB
        session_id = f"sess_{uuid.uuid4().hex[:12]}"
        client_ip = request.client.host if request.client else ""
        user_agent = request.headers.get("user-agent", "")
        await conn.execute(
            """
            INSERT INTO user_sessions (id, user_id, token_jti, ip_address, user_agent, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            session_id, user["id"], token_data["jti"], client_ip, user_agent, token_data["expires_at"]
        )

        await log_system_action(dict(user), "user_login", user["id"], user["email"])

        return {
            "status": "success",
            "user": {
                "id": user["id"],
                "email": user["email"],
                "full_name": user["full_name"],
                "role": user["role"],
                "status": user["status"],
                "must_change_password": user["must_change_password"],
                "permissions": list(ROLE_PERMISSIONS.get(user["role"], set()))
            },
            "token": token_data["token"],
            "expires_at": token_data["expires_at"].isoformat()
        }


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Return authenticated user profile and permissions."""
    role = current_user["role"]
    permissions = list(ROLE_PERMISSIONS.get(role, set()))
    return {
        "user": current_user,
        "permissions": permissions
    }


@router.post("/logout")
async def logout(request: Request, current_user: dict = Depends(get_current_user)):
    """Revoke active user session token."""
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            import jwt
            from app.config import settings
            payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
            jti = payload.get("jti")
            if jti:
                pool = get_pool()
                async with pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE user_sessions SET revoked = true WHERE token_jti = $1", jti
                    )
        except Exception:
            pass
    return {"status": "success", "message": "Logged out successfully"}


@router.post("/change-password")
async def change_password(req: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    """Allow logged in user to update their password."""
    pool = get_pool()
    async with pool.acquire() as conn:
        db_user = await conn.fetchrow(
            "SELECT password_hash FROM users WHERE id = $1", current_user["id"]
        )
        if not db_user or not verify_password(req.old_password, db_user["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Incorrect current password"
            )
        new_hash = hash_password(req.new_password)
        await conn.execute(
            """
            UPDATE users
            SET password_hash = $1, must_change_password = false, updated_at = NOW()
            WHERE id = $2
            """,
            new_hash, current_user["id"]
        )
        return {"status": "success", "message": "Password updated successfully"}
