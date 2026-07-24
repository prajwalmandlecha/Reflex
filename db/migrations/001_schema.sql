-- +goose Up
-- Full schema for Agent Governance Platform (AGP)

-- ============================================================
-- Agent Classes (PRD §7: agent_class)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_classes (
    id                      VARCHAR(64) PRIMARY KEY,
    name                    VARCHAR(128) NOT NULL,
    description             TEXT DEFAULT '',
    -- Default tools this class is allowed to call
    default_allowed_tools   TEXT[] DEFAULT '{}',
    -- Per-tool constraints as JSONB, e.g.:
    -- {
    --   "transfer_money": {
    --     "max_amount": 1000.00,
    --     "max_daily_count": 10,
    --     "allowed_currencies": ["USD","EUR"],
    --     "time_window": {"start":"09:00","end":"17:00","tz":"UTC"}
    --   },
    --   "get_balance": {
    --     "rate_limit": {"max_calls": 100, "window_seconds": 3600}
    --   }
    -- }
    default_constraints     JSONB DEFAULT '{}',
    -- Spend caps with windows, e.g.:
    -- {
    --   "hourly":  {"amount_cents": 500000, "count": 50},
    --   "daily":   {"amount_cents": 5000000, "count": 500},
    --   "per_transaction": {"max_amount_cents": 100000}
    -- }
    default_caps            JSONB DEFAULT '{}',
    status                  VARCHAR(32) DEFAULT 'active',
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Agent Instances (PRD §7: agent_instance)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_instances (
    id                      VARCHAR(64) PRIMARY KEY,
    class_id                VARCHAR(64) NOT NULL REFERENCES agent_classes(id) ON DELETE CASCADE,
    status                  VARCHAR(32) DEFAULT 'active',  -- active / revoked
    -- Override constraints (tighten only; merged with class defaults at read time)
    constraint_overrides    JSONB DEFAULT '{}',
    -- Override caps (tighten only; merged with class defaults at read time)
    cap_overrides           JSONB DEFAULT '{}',
    -- Override allowed tools (must be subset of class defaults; NULL = inherit)
    tool_overrides          TEXT[] DEFAULT NULL,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Bank Connections (PRD §7: bank_connection)
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_connections (
    id                      VARCHAR(64) PRIMARY KEY,
    name                    VARCHAR(128) NOT NULL,
    source_type             VARCHAR(32) NOT NULL,  -- 'native_mcp', 'openapi', 'manual'
    mcp_url                 TEXT,                   -- for native MCP connections
    base_url                TEXT,                   -- for OpenAPI-derived connections
    openapi_spec            TEXT,                   -- raw OpenAPI spec (stored for re-parsing)
    credential_type         VARCHAR(32),            -- 'api_key','bearer','basic','oauth2_cc'
    encrypted_creds         TEXT,                   -- Fernet-encrypted credential blob
    status                  VARCHAR(32) DEFAULT 'connected',  -- connected / error / pending
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Tools (PRD §7: tool)
-- ============================================================
CREATE TABLE IF NOT EXISTS tools (
    id                      SERIAL PRIMARY KEY,
    bank_connection_id      VARCHAR(64) NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
    name                    VARCHAR(128) NOT NULL,
    description             TEXT DEFAULT '',
    input_schema            JSONB DEFAULT '{}',
    underlying_ops          JSONB DEFAULT '[]',   -- e.g. [{"method":"POST","path":"/v1/transfer"}]
    exposed                 BOOLEAN DEFAULT true,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Policies (PRD §7: policy)
-- ============================================================
CREATE TABLE IF NOT EXISTS policies (
    id                      SERIAL PRIMARY KEY,
    name                    VARCHAR(128) NOT NULL UNIQUE,
    scope                   VARCHAR(32) NOT NULL DEFAULT 'global',   -- global / class / instance
    target_id               VARCHAR(64),            -- class_id or instance_id (NULL for global)
    type                    VARCHAR(32) NOT NULL DEFAULT 'rego',     -- rego / visual
    version                 INT NOT NULL DEFAULT 1,
    rego_source             TEXT,
    visual_rules            JSONB DEFAULT '[]',
    status                  VARCHAR(32) DEFAULT 'draft',  -- draft / active / archived
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Policy Change Log (PRD §6.4: config changes versioned)
-- ============================================================
CREATE TABLE IF NOT EXISTS policy_changelog (
    id                      SERIAL PRIMARY KEY,
    policy_id               INT REFERENCES policies(id) ON DELETE SET NULL,
    changed_by              VARCHAR(128) DEFAULT 'operator',
    change_type             VARCHAR(32) NOT NULL,   -- create / update / activate / archive / delete
    old_value               JSONB,
    new_value               JSONB,
    changed_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Config Version (PRD §7: config_version)
-- ============================================================
CREATE TABLE IF NOT EXISTS config_version (
    id                      INT PRIMARY KEY DEFAULT 1,
    version                 BIGINT NOT NULL DEFAULT 1,
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO config_version (id, version) VALUES (1, 1) ON CONFLICT DO NOTHING;

-- ============================================================
-- Audit Log — enhanced with per-stage latency breakdown
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id                      BIGSERIAL PRIMARY KEY,
    agent_id                VARCHAR(64) NOT NULL,
    agent_kind              VARCHAR(64) DEFAULT 'conversational',
    action                  VARCHAR(128) NOT NULL,
    decision                VARCHAR(16) NOT NULL,    -- allow / deny / spend_exceeded / killed
    deny_reason             TEXT DEFAULT '',
    amount                  NUMERIC(14, 2) DEFAULT 0.00,
    currency                VARCHAR(8) DEFAULT 'USD',

    -- Stage-by-stage latency tracking (PRD §6.4: breakdown)
    latency_ms              DOUBLE PRECISION DEFAULT 0.0,
    stage_killswitch_ms     DOUBLE PRECISION DEFAULT 0.0,
    stage_opa_ms            DOUBLE PRECISION DEFAULT 0.0,
    stage_spend_ms          DOUBLE PRECISION DEFAULT 0.0,

    ts                      TIMESTAMPTZ DEFAULT NOW(),

    -- Hash chain for tamper detection
    prev_hash               VARCHAR(64) DEFAULT '',
    entry_hash              VARCHAR(64) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_log(decision);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

-- ============================================================
-- Stop Events Log (emergency stop history)
-- ============================================================
CREATE TABLE IF NOT EXISTS stop_events (
    id                      SERIAL PRIMARY KEY,
    scope                   VARCHAR(32) NOT NULL,     -- fleet / class / instance
    target_id               VARCHAR(64),              -- class_id or agent_id (NULL for fleet)
    action                  VARCHAR(16) NOT NULL,     -- stop / resume
    triggered_by            VARCHAR(128) DEFAULT 'operator',
    reason                  TEXT DEFAULT '',
    created_at              TIMESTAMPTZ DEFAULT NOW()
);
