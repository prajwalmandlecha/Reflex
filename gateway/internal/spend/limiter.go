// Package spend provides atomic, hierarchical spend-cap enforcement via Redis Lua scripts.
//
// A single Lua script atomically increments all applicable scope counters and rolls back
// if any scope's cap is exceeded — no separate read-then-write step, so concurrent
// requests cannot both slip under the limit.
package spend

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Scope defines a single spend-cap scope (agent, category, fleet, global).
type Scope struct {
	Key string `json:"key"` // Redis key, e.g. "spend:agent:pay-agent-01:hourly"
	Cap int64  `json:"cap"` // Cap in the smallest currency unit (e.g. cents)
}

// CheckResult is the outcome of a spend-cap check.
type CheckResult struct {
	Allowed     bool   `json:"allowed"`
	ExceededKey string `json:"exceeded,omitempty"`
	Current     int64  `json:"current,omitempty"`
}

// luaSpendCheck is the Lua script that atomically checks and increments all scope counters.
// If any scope exceeds its cap after increment, all already-incremented scopes are rolled back.
var luaSpendCheck = redis.NewScript(`
local scopes = cjson.decode(ARGV[1])
local amount = tonumber(ARGV[2])
local incremented = {}

for i, scope in ipairs(scopes) do
    local new_val = redis.call('INCRBY', scope.key, amount)
    -- Set a TTL on first creation so windowed counters don't leak forever (G13).
    -- 48h comfortably covers both hourly and daily bucket keys.
    if new_val == amount then
        redis.call('EXPIRE', scope.key, 172800)
    end
    table.insert(incremented, scope.key)
    if new_val > tonumber(scope.cap) then
        -- rollback all already-incremented keys
        for _, k in ipairs(incremented) do
            redis.call('DECRBY', k, amount)
        end
        return cjson.encode({allowed=false, exceeded=scope.key, current=new_val - amount})
    end
end

return cjson.encode({allowed=true})
`)

// Limiter enforces hierarchical spend caps using Redis.
type Limiter struct {
	rdb *redis.Client
}

// NewLimiter creates a spend limiter backed by the given Redis client.
func NewLimiter(rdb *redis.Client) *Limiter {
	return &Limiter{rdb: rdb}
}

// Check atomically verifies and increments spend counters for the given amount across all scopes.
// If any scope would be exceeded, all increments are rolled back and the result indicates the breach.
func (l *Limiter) Check(ctx context.Context, amount int64, scopes []Scope) (*CheckResult, error) {
	if len(scopes) == 0 {
		return &CheckResult{Allowed: true}, nil
	}
	if amount <= 0 {
		return &CheckResult{Allowed: true}, nil
	}

	scopesJSON, err := json.Marshal(scopes)
	if err != nil {
		return nil, fmt.Errorf("marshaling scopes: %w", err)
	}

	// All scope keys passed for Redis cluster compat (unused in single-node mode)
	keys := make([]string, len(scopes))
	for i, s := range scopes {
		keys[i] = s.Key
	}

	result, err := luaSpendCheck.Run(ctx, l.rdb, keys, string(scopesJSON), amount).Text()
	if err != nil {
		return nil, fmt.Errorf("executing spend check: %w", err)
	}

	var cr CheckResult
	if err := json.Unmarshal([]byte(result), &cr); err != nil {
		return nil, fmt.Errorf("parsing spend check result: %w", err)
	}

	return &cr, nil
}

// SetTTL sets the TTL on a spend counter key (call after the first increment in a new window).
func (l *Limiter) SetTTL(ctx context.Context, key string, seconds int64) error {
	return l.rdb.Expire(ctx, key, time.Duration(seconds)*time.Second).Err()
}

// GetCurrentSpend returns the current value of a spend counter.
func (l *Limiter) GetCurrentSpend(ctx context.Context, key string) (int64, error) {
	val, err := l.rdb.Get(ctx, key).Int64()
	if err == redis.Nil {
		return 0, nil
	}
	return val, err
}

// BuildScopeKeys constructs the hierarchical scope keys for a given agent action.
func BuildScopeKeys(agentID, category, window string) []string {
	return []string{
		fmt.Sprintf("spend:agent:%s:%s", agentID, window),
		fmt.Sprintf("spend:category:%s:%s", category, window),
		fmt.Sprintf("spend:fleet:%s", window),
		fmt.Sprintf("spend:global:%s", window),
	}
}
