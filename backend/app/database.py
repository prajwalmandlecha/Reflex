"""Async PostgreSQL connection pool using asyncpg and self-healing schema initialization."""

import logging
import asyncpg
from app.config import settings

logger = logging.getLogger(__name__)

pool: asyncpg.Pool | None = None


def _raw_dsn() -> str:
    """Convert SQLAlchemy-style DSN to plain postgres:// for asyncpg."""
    dsn = settings.pg_dsn
    if dsn.startswith("postgresql+asyncpg://"):
        dsn = dsn.replace("postgresql+asyncpg://", "postgres://", 1)
    return dsn


async def init_pool() -> asyncpg.Pool:
    global pool
    pool = await asyncpg.create_pool(
        _raw_dsn(),
        min_size=2,
        max_size=10,
        command_timeout=30,
    )
    await init_db_schema()
    return pool


async def init_db_schema():
    """Ensure all required tables and sequence generators exist in Postgres."""
    global pool
    if not pool:
        return

    schema_sql = """
    CREATE TABLE IF NOT EXISTS config_version (
        id                      INT PRIMARY KEY DEFAULT 1,
        version                 BIGINT NOT NULL DEFAULT 1,
        updated_at              TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO config_version (id, version) VALUES (1, 1) ON CONFLICT DO NOTHING;

    CREATE TABLE IF NOT EXISTS agent_classes (
        id                      VARCHAR(64) PRIMARY KEY,
        name                    VARCHAR(128) NOT NULL,
        description             TEXT DEFAULT '',
        default_allowed_tools   TEXT[] DEFAULT '{}',
        default_constraints     JSONB DEFAULT '{}',
        default_caps            JSONB DEFAULT '{}',
        status                  VARCHAR(32) DEFAULT 'active',
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        updated_at              TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agent_instances (
        id                      VARCHAR(64) PRIMARY KEY,
        class_id                VARCHAR(64) NOT NULL REFERENCES agent_classes(id) ON DELETE CASCADE,
        status                  VARCHAR(32) DEFAULT 'active',
        constraint_overrides    JSONB DEFAULT '{}',
        cap_overrides           JSONB DEFAULT '{}',
        tool_overrides          TEXT[] DEFAULT NULL,
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        updated_at              TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bank_connections (
        id                      VARCHAR(64) PRIMARY KEY,
        name                    VARCHAR(128) NOT NULL,
        source_type             VARCHAR(32) NOT NULL,
        mcp_url                 TEXT,
        base_url                TEXT,
        openapi_spec            TEXT,
        credential_type         VARCHAR(32),
        encrypted_creds         TEXT,
        status                  VARCHAR(32) DEFAULT 'pending',
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        updated_at              TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tools (
        id                      SERIAL PRIMARY KEY,
        bank_connection_id      VARCHAR(64) NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
        name                    VARCHAR(128) NOT NULL,
        description             TEXT DEFAULT '',
        input_schema            JSONB DEFAULT '{}',
        underlying_ops          JSONB DEFAULT '[]',
        exposed                 BOOLEAN DEFAULT true,
        created_at              TIMESTAMPTZ DEFAULT NOW()
    );

    -- MCP resources exposed by a native MCP bank connection (resources/list).
    CREATE TABLE IF NOT EXISTS resources (
        id                      SERIAL PRIMARY KEY,
        bank_connection_id      VARCHAR(64) NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
        uri                     TEXT NOT NULL,
        name                    VARCHAR(256) DEFAULT '',
        description             TEXT DEFAULT '',
        mime_type               VARCHAR(128) DEFAULT '',
        exposed                 BOOLEAN DEFAULT true,
        created_at              TIMESTAMPTZ DEFAULT NOW()
    );

    -- MCP prompts exposed by a native MCP bank connection (prompts/list).
    CREATE TABLE IF NOT EXISTS prompts (
        id                      SERIAL PRIMARY KEY,
        bank_connection_id      VARCHAR(64) NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
        name                    VARCHAR(128) NOT NULL,
        description             TEXT DEFAULT '',
        arguments               JSONB DEFAULT '[]',
        exposed                 BOOLEAN DEFAULT true,
        created_at              TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS policies (
        id                      SERIAL PRIMARY KEY,
        name                    VARCHAR(128) NOT NULL,
        scope                   VARCHAR(32) NOT NULL DEFAULT 'global',
        target_id               VARCHAR(64),
        type                    VARCHAR(32) NOT NULL DEFAULT 'rego',
        version                 INT NOT NULL DEFAULT 1,
        rego_source             TEXT,
        visual_rules            JSONB DEFAULT '[]',
        status                  VARCHAR(32) DEFAULT 'draft',
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        updated_at              TIMESTAMPTZ DEFAULT NOW()
    );

    -- Global fleet-scoped spend caps. A single row (id=1) holds the platform-wide
    -- caps as JSONB keyed by tool name, e.g.:
    -- {
    --   "transfer_money": [
    --     {"param": "amount_cents", "window": "daily", "limit_cents": 5000000}
    --   ]
    -- }
    -- These are injected into every agent's effective_constraints as
    -- shared_caps entries with scope "fleet" (see config_propagation), so the
    -- gateway enforces them with a single shared Redis counter per tool+param.
    CREATE TABLE IF NOT EXISTS fleet_caps (
        id                      INT PRIMARY KEY DEFAULT 1,
        caps                    JSONB DEFAULT '{}',
        rate_limits             JSONB DEFAULT '{}',
        updated_by              VARCHAR(128) DEFAULT 'admin',
        updated_at              TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO fleet_caps (id, caps) VALUES (1, '{}') ON CONFLICT (id) DO NOTHING;
    -- Self-healing: add the rate_limits column to existing fleet_caps tables
    -- created before this column existed (idempotent, no-op if already present).
    ALTER TABLE fleet_caps ADD COLUMN IF NOT EXISTS rate_limits JSONB DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS policy_changelog (
        id                      SERIAL PRIMARY KEY,
        policy_id               INT REFERENCES policies(id) ON DELETE SET NULL,
        changed_by              VARCHAR(128) DEFAULT 'operator',
        change_type             VARCHAR(32) NOT NULL,
        old_value               JSONB,
        new_value               JSONB,
        changed_at              TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
        id                      BIGSERIAL PRIMARY KEY,
        ts                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        agent_id                VARCHAR(64) NOT NULL,
        agent_class_id          VARCHAR(64) DEFAULT '',
        action                  VARCHAR(128) NOT NULL,
        bank_connection_id      VARCHAR(64) DEFAULT '',
        params                  JSONB DEFAULT '{}',
        response_data           JSONB DEFAULT NULL,
        decision                VARCHAR(16) NOT NULL,
        deny_stage              VARCHAR(32) DEFAULT '',
        reason                  TEXT DEFAULT '',
        spend_delta             BIGINT DEFAULT 0,
        total_latency_ms        DOUBLE PRECISION DEFAULT 0,
        killswitch_latency_ms   DOUBLE PRECISION DEFAULT 0,
        policy_latency_ms       DOUBLE PRECISION DEFAULT 0,
        spend_check_latency_ms  DOUBLE PRECISION DEFAULT 0,
        constraint_latency_ms   DOUBLE PRECISION DEFAULT 0,
        downstream_latency_ms   DOUBLE PRECISION DEFAULT 0,
        governance_overhead_ms  DOUBLE PRECISION DEFAULT 0,
        prev_hash               VARCHAR(64) DEFAULT '',
        entry_hash              VARCHAR(64) NOT NULL
    );
    -- Self-healing: add the response_data column to existing audit_log tables
    -- created before this column existed (idempotent, no-op if already present).
    ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS response_data JSONB DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS stop_events (
        id                      SERIAL PRIMARY KEY,
        scope                   VARCHAR(32) NOT NULL,
        target_id               VARCHAR(64),
        action                  VARCHAR(16) NOT NULL,
        triggered_by            VARCHAR(128) DEFAULT 'operator',
        reason                  TEXT DEFAULT '',
        created_at              TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
        id                      VARCHAR(64) PRIMARY KEY,
        email                   VARCHAR(255) NOT NULL UNIQUE,
        full_name               VARCHAR(128) NOT NULL,
        password_hash           VARCHAR(255) NOT NULL,
        role                    VARCHAR(32) NOT NULL DEFAULT 'auditor',
        status                  VARCHAR(32) NOT NULL DEFAULT 'active',
        must_change_password    BOOLEAN DEFAULT false,
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        updated_at              TIMESTAMPTZ DEFAULT NOW(),
        last_login_at           TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
        id                      VARCHAR(64) PRIMARY KEY,
        user_id                 VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_jti               VARCHAR(64) NOT NULL UNIQUE,
        ip_address              VARCHAR(45) DEFAULT '',
        user_agent              TEXT DEFAULT '',
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        expires_at              TIMESTAMPTZ NOT NULL,
        revoked                 BOOLEAN DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS user_audit_log (
        id                      BIGSERIAL PRIMARY KEY,
        actor_id                VARCHAR(64) NOT NULL,
        actor_email             VARCHAR(255) NOT NULL,
        action                  VARCHAR(64) NOT NULL,
        target_user_id          VARCHAR(64) DEFAULT '',
        target_email            VARCHAR(255) DEFAULT '',
        details                 JSONB DEFAULT '{}',
        created_at              TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions (user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_jti ON user_sessions (token_jti);

    INSERT INTO users (id, email, full_name, password_hash, role, status, must_change_password) VALUES
    ('usr_admin_01', 'admin@reflex.local', 'System Admin', 'pbkdf2_sha256$100000$salt_admin_2026$3f10cb61337a3178f2db704ea826f7e019dc7882f5b6f14fdc4579df96a15e5f', 'admin', 'active', false),
    ('usr_operator_01', 'operator@reflex.local', 'Lead Operator', 'pbkdf2_sha256$100000$salt_oper_2026$260a845794d4c671033f3d1d4bb3ab83196cb0f605c132cd5fdb06d1e4a3bc76', 'operator', 'active', false),
    ('usr_auditor_01', 'auditor@reflex.local', 'Compliance Auditor', 'pbkdf2_sha256$100000$salt_audit_2026$87e76b939cca6635208fcefc3fc3cb240112e9dda19eedd259c5db833b28e232', 'auditor', 'active', false)
    ON CONFLICT (email) DO NOTHING;

    -- Default Rego Security Policy (global scope baseline). Mirrors
    -- db/migrations/002_seed.sql so the backend is self-sufficient and does
    -- not depend on the docker-entrypoint-initdb.d mount.
    INSERT INTO policies (name, scope, target_id, type, version, rego_source, status) VALUES
    ('default', 'global', NULL, 'rego', 1, '
package agp.authz

import rego.v1

default allow := false
default deny := false

# Rule 1: Explicit Per-Agent Allowed Tools Whitelist (ABAC)
allow if {
	count(input.allowed_tools) > 0
	input.action in input.allowed_tools
	not deny
}

reason := sprintf("action ''%s'' allowed by agent profile whitelist", [input.action]) if {
	count(input.allowed_tools) > 0
	input.action in input.allowed_tools
	not deny
}

reason := sprintf("action ''%s'' is not permitted by agent profile whitelist", [input.action]) if {
	count(input.allowed_tools) > 0
	not (input.action in input.allowed_tools)
}

# Catch-all deny reason
reason := sprintf("agent kind ''%s'' is not allowed to perform action ''%s''", [input.agent_kind, input.action]) if {
	count(input.allowed_tools) == 0
	not allow
	not deny
}
', 'active')
    ON CONFLICT DO NOTHING;

    -- Indexes required by upserts and hot query paths. These mirror
    -- db/migrations/001_schema.sql; without them the policies ON CONFLICT
    -- upsert raises 42P10 and audit queries full-table-scan on a DB that was
    -- initialized by this function instead of the SQL migration.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_policies_unique_scope
        ON policies (name, scope, COALESCE(target_id, '__global__'));
    CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
    CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_log(decision);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_class ON audit_log(agent_class_id);
    -- Class name is the unique human-facing governance identity (G15).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_classes_name ON agent_classes(name);
    """
    async with pool.acquire() as conn:
        await conn.execute(schema_sql)
    logger.info("Database schema initialized and verified successfully")


async def close_pool():
    global pool
    if pool:
        await pool.close()
        pool = None


def get_pool() -> asyncpg.Pool:
    assert pool is not None, "Database pool not initialized"
    return pool
