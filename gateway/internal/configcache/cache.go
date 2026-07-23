// Package configcache maintains an in-memory cache of agent & class configurations,
// populated from Redis and falling back to Backend REST calls on cache misses.
package configcache

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// AgentConfig represents effective agent configuration cached in memory.
type AgentConfig struct {
	ID                   string                   `json:"id"`
	ClassID              string                   `json:"class_id"`
	Status               string                   `json:"status"`
	EffectiveTools       []string                 `json:"effective_tools"`
	EffectiveConstraints map[string]map[string]any `json:"effective_constraints"`
	EffectiveCaps        map[string]map[string]any `json:"effective_caps"`
}

// ConfigCache manages agent configurations with atomic in-memory reads,
// Redis pub/sub invalidations, and Backend REST fallbacks.
type ConfigCache struct {
	agents     sync.Map // agentID -> *AgentConfig
	rdb        *redis.Client
	backendURL string
	logger     *slog.Logger
	client     *http.Client
}

// New creates a new ConfigCache instance and starts the Redis pub/sub listener.
func New(ctx context.Context, rdb *redis.Client, backendURL string, logger *slog.Logger) *ConfigCache {
	c := &ConfigCache{
		rdb:        rdb,
		backendURL: backendURL,
		logger:     logger,
		client:     &http.Client{Timeout: 3 * time.Second},
	}

	go c.subscribeUpdates(ctx)
	return c
}

// Get fetches effective configuration for an agent.
// Check order: in-memory map -> Redis key (`agp:inst:{id}`) -> Backend HTTP `/internal/config/{id}`.
func (c *ConfigCache) Get(ctx context.Context, agentID string) *AgentConfig {
	if val, ok := c.agents.Load(agentID); ok {
		return val.(*AgentConfig)
	}

	// Try Redis
	cacheKey := fmt.Sprintf("agp:inst:%s", agentID)
	redisVal, err := c.rdb.Get(ctx, cacheKey).Result()
	if err == nil && redisVal != "" {
		var cfg AgentConfig
		if json.Unmarshal([]byte(redisVal), &cfg) == nil {
			c.agents.Store(agentID, &cfg)
			return &cfg
		}
	}

	// Cache miss -> fallback to Backend REST API
	cfg, err := c.fetchFromBackend(ctx, agentID)
	if err != nil {
		c.logger.Warn("failed to fetch config from backend fallback, using safe default", "agent_id", agentID, "error", err)
		cfg = &AgentConfig{
			ID:                   agentID,
			ClassID:              "default",
			Status:               "active",
			EffectiveTools:       []string{},
			EffectiveConstraints: make(map[string]map[string]any),
			EffectiveCaps:        make(map[string]map[string]any),
		}
	} else {
		c.agents.Store(agentID, cfg)
	}

	return cfg
}

func (c *ConfigCache) fetchFromBackend(ctx context.Context, agentID string) (*AgentConfig, error) {
	url := fmt.Sprintf("%s/internal/config/%s", c.backendURL, agentID)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("backend returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var cfg AgentConfig
	if err := json.Unmarshal(body, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func (c *ConfigCache) subscribeUpdates(ctx context.Context) {
	sub := c.rdb.Subscribe(ctx, "config:updates")
	defer sub.Close()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var update struct {
				Type string `json:"type"`
				ID   string `json:"id"`
			}
			if json.Unmarshal([]byte(msg.Payload), &update) == nil {
				if update.Type == "instance" || update.Type == "kill_agent" || update.Type == "revive_agent" {
					c.agents.Delete(update.ID)
					c.logger.Info("invalidated agent config cache", "agent_id", update.ID)
				} else if update.Type == "class" || update.Type == "policy" || update.Type == "halt_fleet" || update.Type == "resume_fleet" {
					// Clear all in-memory agent configs on class/policy/fleet changes
					c.agents.Range(func(key, value any) bool {
						c.agents.Delete(key)
						return true
					})
					c.logger.Info("invalidated all agent config caches due to global/class change", "type", update.Type)
				}
			}
		}
	}
}
