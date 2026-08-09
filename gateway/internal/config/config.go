// Package config provides environment-based configuration for the gateway.
package config

import (
	"encoding/json"
	"log/slog"
	"os"
	"strconv"
	"time"
)

// Config holds gateway configuration sourced from environment variables.
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

	// Downstream MCP Target Servers
	MCPTargets map[string]string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	targets := make(map[string]string)
	if targetsJSON := os.Getenv("MCP_TARGETS"); targetsJSON != "" {
		if err := json.Unmarshal([]byte(targetsJSON), &targets); err != nil {
			slog.Warn("failed to parse MCP_TARGETS, using defaults only", "error", err)
		}
	}

	if _, ok := targets["default"]; !ok {
		targets["default"] = "http://localhost:9000"
	}

	return &Config{
		MCPPort:     envOr("GATEWAY_MCP_PORT", "8080"),
		MetricsPort: envOr("GATEWAY_METRICS_PORT", "9090"),

		RedisAddr:     envOr("REDIS_ADDR", "localhost:6379"),
		RedisPassword: envOr("REDIS_PASSWORD", ""),
		RedisDB:       envIntOr("REDIS_DB", 0),

		PostgresDSN: envOr("POSTGRES_DSN", "postgres://agp:agp@localhost:5433/agp?sslmode=disable"),
		BackendURL:  envOr("BACKEND_URL", "http://localhost:8000"),

		JWTSecret: envOr("GATEWAY_JWT_SECRET", envOr("JWT_SECRET", "dev-secret-2026")),
		JWTIssuer: envOr("GATEWAY_JWT_ISSUER", envOr("JWT_ISSUER", "agp-gateway")),

		AuditBatchSize:     envIntOr("AUDIT_BATCH_SIZE", 100),
		AuditFlushInterval: envDurationOr("AUDIT_FLUSH_INTERVAL", 500*time.Millisecond),

		PolicyPollInterval: envDurationOr("POLICY_POLL_INTERVAL", 30*time.Second),

		MCPTargets: targets,
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
