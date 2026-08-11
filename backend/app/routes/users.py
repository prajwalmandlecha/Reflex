"""User & Access Management routes (/api/v1/users)."""

import json
import uuid
from typing import Optional
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.auth import (
    ROLE_PERMISSIONS, get_current_user, hash_password, log_system_action, require_permission, require_role
)
from app.database import get_pool

router = APIRouter(prefix="/api/v1/users", tags=["Users"], redirect_slashes=False)


class CreateUserRequest(BaseModel):
    email: str
    full_name: str
    password: str
    role: str = "operator"  # admin, operator, auditor
    must_change_password: bool = False


class UpdateUserRequest(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    new_password: str


@router.get("/roles/permissions")
async def get_roles_permissions_matrix():
    """Return system roles and permission definitions."""
    return {
        "roles": [
            {
                "id": "admin",
                "name": "System Administrator",
                "description": "Full platform control — user management, role assignments, system settings, policy management, class/instance lifecycle, bank connections, emergency stops, audit logs.",
                "permissions": list(ROLE_PERMISSIONS["admin"])
            },
            {
                "id": "operator",
                "name": "Governance & Operations Lead",
                "description": "Full operational control — manage classes & instances, create/edit policies, register bank connections, mint agent tokens, trigger emergency stops, view telemetry.",
                "permissions": list(ROLE_PERMISSIONS["operator"])
            },
            {
                "id": "auditor",
                "name": "Compliance Auditor",
                "description": "Read-only & compliance verification — view telemetry, activity feeds, policies, bank connections, and audit logs. Verify SHA-256 audit log integrity and export reports.",
                "permissions": list(ROLE_PERMISSIONS["auditor"])
            }
        ]
    }


@router.get("")
@router.get("/")
async def list_users(
    query: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: dict = Depends(require_permission("users:read"))
):
    """List all platform users with filtering."""
    pool = get_pool()
    async with pool.acquire() as conn:
        sql = "SELECT id, email, full_name, role, status, must_change_password, created_at, updated_at, last_login_at FROM users WHERE 1=1"
        params = []

        if query:
            params.append(f"%{query.lower()}%")
            sql += f" AND (LOWER(email) LIKE ${len(params)} OR LOWER(full_name) LIKE ${len(params)})"
        if role:
            params.append(role)
            sql += f" AND role = ${len(params)}"
        if status_filter:
            params.append(status_filter)
            sql += f" AND status = ${len(params)}"

        sql += " ORDER BY created_at DESC"
        rows = await conn.fetch(sql, *params)
        return [dict(r) for r in rows]


@router.post("")
@router.post("/")
async def create_user(
    req: CreateUserRequest,
    current_user: dict = Depends(require_permission("users:create"))
):
    """Create a new platform user."""
    if req.role not in ROLE_PERMISSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role '{req.role}'. Valid roles are: {list(ROLE_PERMISSIONS.keys())}"
        )
    user_id = f"usr_{uuid.uuid4().hex[:12]}"
    pwd_hash = hash_password(req.password)
    pool = get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchval("SELECT id FROM users WHERE email = $1", req.email.lower())
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"User with email '{req.email}' already exists."
            )

        row = await conn.fetchrow(
            """
            INSERT INTO users (id, email, full_name, password_hash, role, status, must_change_password)
            VALUES ($1, $2, $3, $4, $5, 'active', $6)
            RETURNING id, email, full_name, role, status, must_change_password, created_at
            """,
            user_id, req.email.lower(), req.full_name, pwd_hash, req.role, req.must_change_password
        )

        # Audit Log
        await conn.execute(
            """
            INSERT INTO user_audit_log (actor_id, actor_email, action, target_user_id, target_email, details)
            VALUES ($1, $2, 'user_created', $3, $4, $5)
            """,
            current_user["id"], current_user["email"], user_id, req.email.lower(),
            json.dumps({"role": req.role, "full_name": req.full_name})
        )

        return dict(row)


@router.get("/{user_id}")
async def get_user_details(
    user_id: str,
    current_user: dict = Depends(require_permission("users:read"))
):
    """Get user profile details and session history."""
    pool = get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, email, full_name, role, status, must_change_password, created_at, updated_at, last_login_at FROM users WHERE id = $1",
            user_id
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        sessions = await conn.fetch(
            "SELECT id, ip_address, user_agent, created_at, expires_at, revoked FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10",
            user_id
        )
        return {
            "user": dict(user),
            "recent_sessions": [dict(s) for s in sessions]
        }


@router.put("/{user_id}")
async def update_user(
    user_id: str,
    req: UpdateUserRequest,
    current_user: dict = Depends(require_permission("users:update"))
):
    """Update user information (name, email, or role)."""
    if req.role and req.role not in ROLE_PERMISSIONS:
        raise HTTPException(status_code=400, detail=f"Invalid role '{req.role}'")

    pool = get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT id, email, role FROM users WHERE id = $1", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        updates = []
        params = [user_id]

        if req.full_name:
            params.append(req.full_name)
            updates.append(f"full_name = ${len(params)}")
        if req.email:
            params.append(req.email.lower())
            updates.append(f"email = ${len(params)}")
        if req.role:
            params.append(req.role)
            updates.append(f"role = ${len(params)}")

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        updates.append("updated_at = NOW()")
        sql = f"UPDATE users SET {', '.join(updates)} WHERE id = $1 RETURNING id, email, full_name, role, status, updated_at"
        row = await conn.fetchrow(sql, *params)

        # If role changed, revoke all active sessions for this user so new role takes effect
        if req.role and req.role != user["role"]:
            await conn.execute("UPDATE user_sessions SET revoked = true WHERE user_id = $1", user_id)

        # Audit Log
        await conn.execute(
            """
            INSERT INTO user_audit_log (actor_id, actor_email, action, target_user_id, target_email, details)
            VALUES ($1, $2, 'user_updated', $3, $4, $5)
            """,
            current_user["id"], current_user["email"], user_id, user["email"],
            json.dumps({"updated_fields": [k for k, v in req.model_dump().items() if v is not None]})
        )

        return dict(row)


@router.post("/{user_id}/suspend")
async def toggle_user_suspension(
    user_id: str,
    action: str = Query("suspend"),  # "suspend" or "activate"
    current_user: dict = Depends(require_permission("users:suspend"))
):
    """Suspend or reactivate a user account."""
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="You cannot suspend your own account.")

    new_status = "suspended" if action == "suspend" else "active"
    pool = get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT email FROM users WHERE id = $1", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        await conn.execute(
            "UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2",
            new_status, user_id
        )

        # Revoke sessions if suspended
        if new_status == "suspended":
            await conn.execute("UPDATE user_sessions SET revoked = true WHERE user_id = $1", user_id)

        # Audit Log
        await conn.execute(
            """
            INSERT INTO user_audit_log (actor_id, actor_email, action, target_user_id, target_email, details)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            current_user["id"], current_user["email"], f"user_{new_status}", user_id, user["email"],
            json.dumps({"new_status": new_status})
        )

        return {"status": "success", "user_id": user_id, "new_status": new_status}


@router.post("/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    req: ResetPasswordRequest,
    current_user: dict = Depends(require_permission("users:reset_password"))
):
    """Admin-initiated password reset for a user."""
    pool = get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT email FROM users WHERE id = $1", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        pwd_hash = hash_password(req.new_password)
        await conn.execute(
            "UPDATE users SET password_hash = $1, must_change_password = true, updated_at = NOW() WHERE id = $2",
            pwd_hash, user_id
        )

        # Revoke sessions so user must log in with new password
        await conn.execute("UPDATE user_sessions SET revoked = true WHERE user_id = $1", user_id)

        # Audit Log
        await conn.execute(
            """
            INSERT INTO user_audit_log (actor_id, actor_email, action, target_user_id, target_email, details)
            VALUES ($1, $2, 'password_reset', $3, $4, '{}')
            """,
            current_user["id"], current_user["email"], user_id, user["email"]
        )

        return {"status": "success", "message": f"Password reset successfully for user {user['email']}"}


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    current_user: dict = Depends(require_permission("users:delete"))
):
    """Delete a user account."""
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

    pool = get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT email FROM users WHERE id = $1", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        await conn.execute("DELETE FROM users WHERE id = $1", user_id)

        # Audit Log
        await conn.execute(
            """
            INSERT INTO user_audit_log (actor_id, actor_email, action, target_user_id, target_email, details)
            VALUES ($1, $2, 'user_deleted', $3, $4, '{}')
            """,
            current_user["id"], current_user["email"], user_id, user["email"]
        )

        return {"status": "success", "message": f"User {user['email']} deleted successfully"}
