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

// ToolSchema carries the minimal schema facts the gateway needs for
// fail-closed money-field enforcement: which argument fields a tool declares
// as REQUIRED. This lets the gateway distinguish a required money field
// (deny when missing) from an optional one (a legitimate call may omit it,
// e.g. a "scale" multiplier).
type ToolSchema struct {
	Required []string `json:"required"`
}

// AgentConfig represents effective agent configuration cached in memory.
type AgentConfig struct {
	ID                   string                    `json:"id"`
	ClassID              string                    `json:"class_id"`
	Status               string                    `json:"status"`
	EffectiveTools       []string                  `json:"effective_tools"`
	EffectiveConstraints map[string]map[string]any `json:"effective_constraints"`
	ToolSchemas          map[string]ToolSchema     `json:"tool_schemas"`
}

// ConfigCache manages agent configurations with atomic in-memory reads,
// Redis pub/sub invalidations, and Backend REST fallbacks.
type ConfigCache struct {
	agents     sync.Map // agentID -> *cachedConfig
	rdb        *redis.Client
	backendURL string
	logger     *slog.Logger
	client     *http.Client
	ttl        time.Duration
}

// cachedConfig wraps an AgentConfig with its in-memory expiry so a missed
// config:updates pub/sub message can't leave a stale config served forever.
type cachedConfig struct {
	cfg       *AgentConfig
	expiresAt time.Time
}

// New creates a new ConfigCache instance and starts the Redis pub/sub listener.
func New(ctx context.Context, rdb *redis.Client, backendURL string, logger *slog.Logger) *ConfigCache {
	return NewWithTTL(ctx, rdb, backendURL, logger, 30*time.Second)
}

// NewWithTTL is New with a configurable in-memory TTL. A TTL of 0 disables
// expiry (entries live until invalidated by pub/sub).
func NewWithTTL(ctx context.Context, rdb *redis.Client, backendURL string, logger *slog.Logger, ttl time.Duration) *ConfigCache {
	c := &ConfigCache{
		rdb:        rdb,
		backendURL: backendURL,
		logger:     logger,
		client:     &http.Client{Timeout: 3 * time.Second},
		ttl:        ttl,
	}

	go c.subscribeUpdates(ctx)
	return c
}

// Get fetches effective configuration for an agent.
// Check order: in-memory map (if fresh) -> Redis key (`agp:inst:{id}`) -> Backend HTTP `/internal/config/{id}`.
// On any failure to determine the agent's config it returns a FAIL-CLOSED
// config (Status "unknown") so an unreachable/unknown agent is denied rather
// than silently falling through to permissive agent-kind rules.
func (c *ConfigCache) Get(ctx context.Context, agentID string) *AgentConfig {
	if val, ok := c.agents.Load(agentID); ok {
		cc := val.(*cachedConfig)
		if c.ttl == 0 || time.Now().Before(cc.expiresAt) {
			return cc.cfg
		}
		// Expired — fall through to re-fetch.
		c.agents.Delete(agentID)
	}

	// Try Redis
	cacheKey := fmt.Sprintf("agp:inst:%s", agentID)
	redisVal, err := c.rdb.Get(ctx, cacheKey).Result()
	if err == nil && redisVal != "" {
		var cfg AgentConfig
		if json.Unmarshal([]byte(redisVal), &cfg) == nil {
			c.store(agentID, &cfg)
			return &cfg
		}
	}

	// Cache miss -> fallback to Backend REST API
	cfg, err := c.fetchFromBackend(ctx, agentID)
	if err != nil {
		c.logger.Warn("failed to fetch config from backend fallback, failing closed", "agent_id", agentID, "error", err)
		cfg = &AgentConfig{
			ID:                   agentID,
			ClassID:              "default",
			Status:               "unknown",
			EffectiveTools:       []string{},
			EffectiveConstraints: make(map[string]map[string]any),
			ToolSchemas:          make(map[string]ToolSchema),
		}
	} else {
		c.store(agentID, cfg)
	}

	return cfg
}

// store caches a config with its expiry.
func (c *ConfigCache) store(agentID string, cfg *AgentConfig) {
	cc := &cachedConfig{cfg: cfg}
	if c.ttl > 0 {
		cc.expiresAt = time.Now().Add(c.ttl)
	}
	c.agents.Store(agentID, cc)
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
				} else if update.Type == "class" || update.Type == "policy" || update.Type == "halt_fleet" || update.Type == "resume_fleet" || update.Type == "fleet_caps" {
					// Clear all in-memory agent configs on class/policy/fleet changes.
					// "fleet_caps" is included because fleet-scoped shared_caps and
					// shared_rate_limits are injected into every agent's
					// effective_constraints; without invalidating here the gateway
					// would keep serving stale configs that lack the new fleet caps.
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
