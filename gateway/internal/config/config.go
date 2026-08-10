// Package config provides environment-based configuration for the gateway.
package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds gateway configuration sourced from environment variables.
// NOTE: MCP downstream targets are NOT configured here. They are user-managed
// data registered via the Control Center UI (bank connections) and discovered
// by the gateway from the Redis agp:connections cache at startup and via
// hot-reload on config:updates pub/sub.
type Config struct {
	// Server ports
	MCPPort     string
	MetricsPort string

	// Redis
	RedisAddr     string
	RedisPassword string
	RedisDB       int

	// Postgres
	PostgresDSN string

	// Backend Service URL for config cache misses
	BackendURL string

	// JWT
	JWTSecret string
	JWTIssuer string

	// Audit
	AuditBatchSize     int
	AuditFlushInterval time.Duration

	// Policy
	PolicyPollInterval time.Duration
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	return &Config{
		MCPPort:     envOr("GATEWAY_MCP_PORT", "8080"),
		MetricsPort: envOr("GATEWAY_METRICS_PORT", "9090"),

		RedisAddr:     envOr("REDIS_ADDR", "localhost:6379"),
		RedisPassword: envOr("REDIS_PASSWORD", ""),
		RedisDB:       envIntOr("REDIS_DB", 0),

		PostgresDSN: envOr("POSTGRES_DSN", ""),
		BackendURL:  envOr("BACKEND_URL", ""),

		JWTSecret: envOr("GATEWAY_JWT_SECRET", envOr("JWT_SECRET", "dev-secret-2026")),
		JWTIssuer: envOr("GATEWAY_JWT_ISSUER", envOr("JWT_ISSUER", "agp-gateway")),

		AuditBatchSize:     envIntOr("AUDIT_BATCH_SIZE", 100),
		AuditFlushInterval: envDurationOr("AUDIT_FLUSH_INTERVAL", 500*time.Millisecond),

		PolicyPollInterval: envDurationOr("POLICY_POLL_INTERVAL", 30*time.Second),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envIntOr(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func envDurationOr(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
