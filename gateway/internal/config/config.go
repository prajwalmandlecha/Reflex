// Package config provides environment-based configuration for the gateway.
package config

import (
	"encoding/json"
	"os"
	"strconv"
	"time"
)

// Config holds all gateway configuration, sourced from environment variables.
type Config struct {
	// Server
	MCPPort     string
	MetricsPort string

	// Redis
	RedisAddr     string
	RedisPassword string
	RedisDB       int

	// Postgres
	PostgresDSN string

	// JWT
	JWTSecret     string
	JWTIssuer     string
	JWTDefaultTTL time.Duration

	// Audit
	AuditBatchSize     int
	AuditFlushInterval time.Duration

	// Policy
	PolicyPollInterval time.Duration

	// Downstream MCP Target Servers (multi-server support)
	// Map of service names to target MCP URLs
	// e.g. {"default": "http://localhost:9000", "bank-payments": "http://localhost:9001"}
	MCPTargets map[string]string
}

// Load reads configuration from environment variables with defaults.
func Load() *Config {
	targets := make(map[string]string)
	if targetsJSON := os.Getenv("MCP_TARGETS"); targetsJSON != "" {
		_ = json.Unmarshal([]byte(targetsJSON), &targets)
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

		PostgresDSN: envOr("POSTGRES_DSN", "postgres://agp:agp@localhost:5432/agp?sslmode=disable"),

		JWTSecret:     envOr("GATEWAY_JWT_SECRET", "dev-secret-change-in-prod"),
		JWTIssuer:     envOr("GATEWAY_JWT_ISSUER", "agp-gateway"),
		JWTDefaultTTL: envDurationOr("GATEWAY_JWT_TTL", 15*time.Minute),

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
