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

    CREATE TABLE IF NOT EXISTS stop_events (
        id                      SERIAL PRIMARY KEY,
        scope                   VARCHAR(32) NOT NULL,
        target_id               VARCHAR(64),
        action                  VARCHAR(16) NOT NULL,
        triggered_by            VARCHAR(128) DEFAULT 'operator',
        reason                  TEXT DEFAULT '',
        created_at              TIMESTAMPTZ DEFAULT NOW()
    );

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
