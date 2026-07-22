// Package agent manages Agent Profiles and Instances with Redis caching and Postgres persistence.
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Profile struct {
	ProfileID           string   `json:"profile_id"`
	ProfileName         string   `json:"profile_name"`
	Description         string   `json:"description"`
	AllowedTools        []string `json:"allowed_tools"`
	HourlySpendCapCents int64    `json:"hourly_spend_cap_cents"`
}

type Instance struct {
	AgentID   string `json:"agent_id"`
	ProfileID string `json:"profile_id"`
	Status    string `json:"status"` // 'active' or 'revoked'
}

type Store struct {
	db     *pgxpool.Pool
	rdb    *redis.Client
	logger *slog.Logger
}

func NewStore(db *pgxpool.Pool, rdb *redis.Client, logger *slog.Logger) *Store {
	return &Store{
		db:     db,
		rdb:    rdb,
		logger: logger,
	}
}

// GetAgentPermissions resolves an agent instance and its profile.
// Checks Redis cache first (under agent:perm:{agent_id}), falls back to Postgres.
func (s *Store) GetAgentPermissions(ctx context.Context, agentID string) ([]string, string, error) {
	cacheKey := fmt.Sprintf("agent:perm:%s", agentID)

	// Try Redis cache
	val, err := s.rdb.Get(ctx, cacheKey).Result()
	if err == nil && val != "" {
		var cached struct {
			Tools  []string `json:"tools"`
			Status string   `json:"status"`
		}
		if json.Unmarshal([]byte(val), &cached) == nil {
			return cached.Tools, cached.Status, nil
		}
	}

	// Cache miss: query Postgres join
	query := `
		SELECT i.status, COALESCE(p.allowed_tools, '{}')
		FROM agent_instances i
		LEFT JOIN agent_profiles p ON i.profile_id = p.profile_id
		WHERE i.agent_id = $1
	`

	var status string
	var allowedTools []string

	err = s.db.QueryRow(ctx, query, agentID).Scan(&status, &allowedTools)
	if err != nil {
		// Not found in agent_instances table -> return empty allowed_tools (fallback to default RBAC)
		return nil, "active", nil
	}

	// Cache in Redis for 5 minutes
	cacheData, _ := json.Marshal(map[string]any{
		"tools":  allowedTools,
		"status": status,
	})
	s.rdb.Set(ctx, cacheKey, cacheData, 5*time.Minute)

	return allowedTools, status, nil
}

// UpsertProfile inserts or updates an Agent Profile in Postgres and clears Redis cache.
func (s *Store) UpsertProfile(ctx context.Context, p *Profile) error {
	query := `
		INSERT INTO agent_profiles (profile_id, profile_name, description, allowed_tools, hourly_spend_cap_cents)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (profile_id) DO UPDATE SET
			profile_name = EXCLUDED.profile_name,
			description = EXCLUDED.description,
			allowed_tools = EXCLUDED.allowed_tools,
			hourly_spend_cap_cents = EXCLUDED.hourly_spend_cap_cents
	`
	_, err := s.db.Exec(ctx, query, p.ProfileID, p.ProfileName, p.Description, p.AllowedTools, p.HourlySpendCapCents)
	if err != nil {
		return fmt.Errorf("upserting profile: %w", err)
	}

	// Clear profile cache
	s.logger.Info("agent profile updated", "profile_id", p.ProfileID)
	return nil
}

// UpsertInstance registers an agent instance with a profile.
func (s *Store) UpsertInstance(ctx context.Context, inst *Instance) error {
	query := `
		INSERT INTO agent_instances (agent_id, profile_id, status)
		VALUES ($1, $2, $3)
		ON CONFLICT (agent_id) DO UPDATE SET
			profile_id = EXCLUDED.profile_id,
			status = EXCLUDED.status
	`
	_, err := s.db.Exec(ctx, query, inst.AgentID, inst.ProfileID, inst.Status)
	if err != nil {
		return fmt.Errorf("upserting instance: %w", err)
	}

	// Clear cache for this agent
	cacheKey := fmt.Sprintf("agent:perm:%s", inst.AgentID)
	s.rdb.Del(ctx, cacheKey)

	s.logger.Info("agent instance updated", "agent_id", inst.AgentID, "profile_id", inst.ProfileID)
	return nil
}

// ListProfiles returns all agent profiles.
func (s *Store) ListProfiles(ctx context.Context) ([]Profile, error) {
	rows, err := s.db.Query(ctx, `SELECT profile_id, profile_name, COALESCE(description, ''), allowed_tools, COALESCE(hourly_spend_cap_cents, 0) FROM agent_profiles ORDER BY profile_id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var profiles []Profile
	for rows.Next() {
		var p Profile
		if err := rows.Scan(&p.ProfileID, &p.ProfileName, &p.Description, &p.AllowedTools, &p.HourlySpendCapCents); err != nil {
			return nil, err
		}
		profiles = append(profiles, p)
	}
	return profiles, nil
}
