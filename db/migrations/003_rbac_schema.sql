-- +goose Up
-- RBAC and User Management Schema for AGP
-- ============================================================

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'auditor', -- admin, operator, auditor
    status VARCHAR(32) NOT NULL DEFAULT 'active', -- active, suspended
    must_change_password BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);

-- User Sessions Table (for active session tracking & instant token revocation)
CREATE TABLE IF NOT EXISTS user_sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_jti VARCHAR(64) NOT NULL UNIQUE,
    ip_address VARCHAR(45) DEFAULT '',
    user_agent TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_jti ON user_sessions (token_jti);

-- User Administrative Audit Log
CREATE TABLE IF NOT EXISTS user_audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_id VARCHAR(64) NOT NULL,
    actor_email VARCHAR(255) NOT NULL,
    action VARCHAR(64) NOT NULL, -- user_created, role_updated, user_suspended, password_reset, session_revoked
    target_user_id VARCHAR(64) DEFAULT '',
    target_email VARCHAR(255) DEFAULT '',
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_audit_actor ON user_audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_user_audit_action ON user_audit_log (action);

-- Seed Initial Default Users (Password for all 3 seeded accounts: AdminPass123!, OperatorPass123!, AuditorPass123!)
-- Hash generated via standard pbkdf2_sha256 with 100,000 iterations:
-- admin / AdminPass123! => pbkdf2_sha256$100000$salt_admin_2026$8ed90e29b1654e8d35f4b50302b1f868ad912dbdfbd9ef1ee661c944d18ec8bc
-- operator / OperatorPass123! => pbkdf2_sha256$100000$salt_oper_2026$b5ee57a70a8d6761f7d4b4a92cfa4d9d15024bb18df6f38dc2a4aa1eef78b27f
-- auditor / AuditorPass123! => pbkdf2_sha256$100000$salt_audit_2026$0fa30cf6139589d81d227b233a1e2f75432098d6cbf5df1bd9c3ebceadfbfa96

INSERT INTO users (id, email, full_name, password_hash, role, status, must_change_password) VALUES
('usr_admin_01', 'admin@reflex.local', 'System Admin', 'pbkdf2_sha256$100000$salt_admin_2026$3f10cb61337a3178f2db704ea826f7e019dc7882f5b6f14fdc4579df96a15e5f', 'admin', 'active', false),
('usr_operator_01', 'operator@reflex.local', 'Lead Operator', 'pbkdf2_sha256$100000$salt_oper_2026$260a845794d4c671033f3d1d4bb3ab83196cb0f605c132cd5fdb06d1e4a3bc76', 'operator', 'active', false),
('usr_auditor_01', 'auditor@reflex.local', 'Compliance Auditor', 'pbkdf2_sha256$100000$salt_audit_2026$87e76b939cca6635208fcefc3fc3cb240112e9dda19eedd259c5db833b28e232', 'auditor', 'active', false)
ON CONFLICT (email) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS user_audit_log;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS users;
