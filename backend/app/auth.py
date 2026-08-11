"""Authentication, Password Hashing, JWT Session, and RBAC Dependencies."""

import datetime
import hashlib
import hmac
import os
import uuid
from typing import List, Optional

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt

from app.config import settings
from app.database import get_pool

security_scheme = HTTPBearer(auto_error=False)

ROLE_PERMISSIONS = {
    "admin": {
        "users:read", "users:create", "users:update", "users:delete", "users:suspend", "users:reset_password",
        "classes:read", "classes:create", "classes:update", "classes:delete",
        "instances:read", "instances:create", "instances:mint_token", "instances:update", "instances:revoke", "instances:revive",
        "estop:read", "estop:trigger",
        "policies:read", "policies:create", "policies:update", "policies:archive",
        "bank:read", "bank:create", "bank:update", "bank:delete", "bank:probe",
        "audit:read", "audit:verify", "audit:export",
        "settings:read", "settings:update"
    },
    "operator": {
        "classes:read", "classes:create", "classes:update", "classes:delete",
        "instances:read", "instances:create", "instances:mint_token", "instances:update", "instances:revoke", "instances:revive",
        "estop:read", "estop:trigger",
        "policies:read", "policies:create", "policies:update", "policies:archive",
        "bank:read", "bank:create", "bank:update", "bank:delete", "bank:probe"
    },
    "auditor": {
        "audit:read", "audit:verify", "audit:export"
    }
}


def hash_password(password: str, salt: Optional[str] = None) -> str:
    """Generate PBKDF2-SHA256 password hash string."""
    if not salt:
        salt = os.urandom(16).hex()
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    )
    return f"pbkdf2_sha256$100000${salt}${key.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    """Verify password against stored hash."""
    try:
        parts = password_hash.split('$')
        if len(parts) != 4 or parts[0] != 'pbkdf2_sha256':
            return False
        iterations = int(parts[1])
        salt = parts[2]
        expected_key = parts[3]
        key = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            salt.encode('utf-8'),
            iterations
        )
        return hmac.compare_digest(key.hex(), expected_key)
    except Exception:
        return False


def create_user_token(user_id: str, email: str, role: str, full_name: str) -> dict:
    """Mint signed JWT token for user session."""
    now = datetime.datetime.now(datetime.timezone.utc)
    jti = str(uuid.uuid4())
    expires = now + datetime.timedelta(hours=24)
    payload = {
        "iss": settings.jwt_issuer,
        "sub": user_id,
        "email": email,
        "role": role,
        "full_name": full_name,
        "jti": jti,
        "iat": now,
        "exp": expires,
        "type": "user_session"
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return {
        "token": token,
        "jti": jti,
        "expires_at": expires,
        "role": role,
        "user_id": user_id,
        "email": email,
        "full_name": full_name
    }


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security_scheme)
) -> dict:
    """FastAPI Dependency: Authenticate user from Bearer Token or allow bypass if auth is disabled in dev mode."""
    if not credentials:
        # If no auth header provided, check if system has dev bypass or return 401
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        if payload.get("type") != "user_session":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type for operator actions"
            )
        user_id = payload.get("sub")
        role = payload.get("role")
        email = payload.get("email")

        # Validate against database user status
        pool = get_pool()
        async with pool.acquire() as conn:
            user = await conn.fetchrow(
                "SELECT id, email, full_name, role, status, must_change_password FROM users WHERE id = $1",
                user_id
            )
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User account no longer exists"
                )
            if user["status"] != "active":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User account is suspended"
                )

            # Check if token JTI is revoked
            jti = payload.get("jti")
            if jti:
                revoked = await conn.fetchval(
                    "SELECT revoked FROM user_sessions WHERE token_jti = $1", jti
                )
                if revoked:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Session token has been revoked"
                    )

            return dict(user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token expired"
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )


def require_role(allowed_roles: List[str]):
    """FastAPI Dependency Generator: Restrict route access to specific roles."""
    async def role_checker(current_user: dict = Depends(get_current_user)):
        user_role = current_user.get("role")
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Action forbidden for role '{user_role}'. Required roles: {allowed_roles}"
            )
        return current_user
    return role_checker


def require_permission(permission: str):
    """FastAPI Dependency Generator: Restrict route access to users with a specific permission."""
    async def permission_checker(current_user: dict = Depends(get_current_user)):
        user_role = current_user.get("role")
        user_permissions = ROLE_PERMISSIONS.get(user_role, set())
        if permission not in user_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user_role}' lacks required permission '{permission}'"
            )
        return current_user
    return permission_checker


async def log_system_action(
    actor: Optional[dict],
    action: str,
    target_id: str = "",
    target_email: str = "",
    details: Optional[dict] = None
):
    """Log administrative, governance, policy, fleet, user, or connection operations into user_audit_log."""
    try:
        actor_id = actor.get("id", "system") if isinstance(actor, dict) else "system"
        actor_email = actor.get("email", "system@reflex.local") if isinstance(actor, dict) else "system@reflex.local"
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO user_audit_log (actor_id, actor_email, action, target_user_id, target_email, details)
                VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                """,
                actor_id,
                actor_email,
                action,
                target_id or "",
                target_email or "",
                json.dumps(details or {})
            )
    except Exception as e:
        print(f"[SYSTEM AUDIT LOG ERROR] Failed to write system audit log: {e}")
