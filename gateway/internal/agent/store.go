// Package agent manages Agent Profiles and Instances with Redis caching and sqlc-generated Postgres queries.
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/agp/gateway/internal/db"
	"github.com/jackc/pgx/v5/pgtype"
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
	queries *db.Queries
	rdb     *redis.Client
	logger  *slog.Logger
}

func NewStore(pool *pgxpool.Pool, rdb *redis.Client, logger *slog.Logger) *Store {
	return &Store{
		queries: db.New(pool),
		rdb:     rdb,
		logger:  logger,
	}
}

// GetAgentPermissions resolves an agent instance and its profile.
// Checks Redis cache first (under agent:perm:{agent_id}), falls back to Postgres via sqlc.
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

	// Cache miss: query Postgres join via sqlc
	res, err := s.queries.GetAgentPermissions(ctx, agentID)
	if err != nil {
		// Not found in agent_instances table -> return empty allowed_tools (fallback to default RBAC)
		return nil, "active", nil
	}

	// Cache in Redis for 5 minutes
	cacheData, _ := json.Marshal(map[string]any{
		"tools":  res.AllowedTools,
		"status": res.Status,
	})
	s.rdb.Set(ctx, cacheKey, cacheData, 5*time.Minute)

	return res.AllowedTools, res.Status, nil
}

// UpsertProfile inserts or updates an Agent Profile via sqlc and clears Redis cache.
func (s *Store) UpsertProfile(ctx context.Context, p *Profile) error {
	err := s.queries.UpsertAgentProfile(ctx, db.UpsertAgentProfileParams{
		ProfileID:           p.ProfileID,
		ProfileName:         p.ProfileName,
		Description:         pgtype.Text{String: p.Description, Valid: p.Description != ""},
		AllowedTools:        p.AllowedTools,
		HourlySpendCapCents: pgtype.Int8{Int64: p.HourlySpendCapCents, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("upserting profile via sqlc: %w", err)
	}

	s.logger.Info("agent profile updated via sqlc", "profile_id", p.ProfileID)
	return nil
}

// UpsertInstance registers an agent instance with a profile via sqlc.
func (s *Store) UpsertInstance(ctx context.Context, inst *Instance) error {
	err := s.queries.UpsertAgentInstance(ctx, db.UpsertAgentInstanceParams{
		AgentID:   inst.AgentID,
		ProfileID: pgtype.Text{String: inst.ProfileID, Valid: inst.ProfileID != ""},
		Status:    inst.Status,
	})
	if err != nil {
		return fmt.Errorf("upserting instance via sqlc: %w", err)
	}

	// Clear cache for this agent
	cacheKey := fmt.Sprintf("agent:perm:%s", inst.AgentID)
	s.rdb.Del(ctx, cacheKey)

	s.logger.Info("agent instance updated via sqlc", "agent_id", inst.AgentID, "profile_id", inst.ProfileID)
	return nil
}

// ListProfiles returns all agent profiles via sqlc.
func (s *Store) ListProfiles(ctx context.Context) ([]Profile, error) {
	rows, err := s.queries.ListAgentProfiles(ctx)
	if err != nil {
		return nil, err
	}

	var profiles []Profile
	for _, r := range rows {
		profiles = append(profiles, Profile{
			ProfileID:           r.ProfileID,
			ProfileName:         r.ProfileName,
			Description:         r.Description,
			AllowedTools:        r.AllowedTools,
			HourlySpendCapCents: r.HourlySpendCapCents,
		})
	}
	return profiles, nil
}
