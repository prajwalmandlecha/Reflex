// Package spend provides atomic enforcement of ALL stateful governance counters
// (hierarchical spend caps, per-tool rate limits, cumulative daily spend) via a
// single Redis Lua script.
//
// One script atomically increments every applicable counter and rolls all of
// them back if any cap is exceeded — no separate read-then-write step and no
// partially-committed state, so denied calls never consume budget (G4) and
// concurrent requests cannot both slip under a limit (no TOCTOU window).
package spend

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// Entry is one stateful counter to commit: increment Key by Amount, enforce
// Cap (0 = uncapped), and set TTLSeconds when the key is first created.
type Entry struct {
	Key        string  `json:"key"`
	Amount     float64 `json:"amount"`
	Cap        float64 `json:"cap"`
	TTLSeconds int64   `json:"ttl"`
	Label      string  `json:"label,omitempty"` // human-readable description used in deny reasons
}

// CommitResult is the outcome of an atomic counter commit.
type CommitResult struct {
	Allowed  bool    `json:"allowed"`
	Exceeded string  `json:"exceeded,omitempty"` // Redis key of the breached counter
	Label    string  `json:"label,omitempty"`
	Current  float64 `json:"current,omitempty"` // counter value BEFORE this call's increment
	Cap      float64 `json:"cap,omitempty"`
}

// luaCommit atomically increments all counters; if any counter exceeds its cap
// after increment, every already-applied increment (including the breaching
// one) is rolled back before returning the breach.
var luaCommit = redis.NewScript(`
local entries = cjson.decode(ARGV[1])
local applied = {}

for i, e in ipairs(entries) do
    local new_val = tonumber(redis.call('INCRBYFLOAT', e.key, e.amount))
    table.insert(applied, e)
    -- Set a TTL on first creation so windowed counters don't leak forever (G13).
    if new_val == e.amount and e.ttl > 0 then
        redis.call('EXPIRE', e.key, e.ttl)
    end
    if e.cap > 0 and new_val > e.cap then
        -- rollback ALL already-applied increments
        for _, a in ipairs(applied) do
            redis.call('INCRBYFLOAT', a.key, -a.amount)
        end
        return cjson.encode({allowed=false, exceeded=e.key, label=e.label, current=new_val - e.amount, cap=e.cap})
    end
end

return cjson.encode({allowed=true})
`)

// Limiter commits governance counters atomically using Redis.
type Limiter struct {
	rdb *redis.Client
}

// NewLimiter creates a limiter backed by the given Redis client.
func NewLimiter(rdb *redis.Client) *Limiter {
	return &Limiter{rdb: rdb}
}

// Commit atomically increments every entry's counter with all-or-nothing
// semantics: if any cap would be breached, no counter retains an increment.
// Entries with a non-positive Amount are skipped.
func (l *Limiter) Commit(ctx context.Context, entries []Entry) (*CommitResult, error) {
	active := make([]Entry, 0, len(entries))
	for _, e := range entries {
		if e.Amount > 0 {
			active = append(active, e)
		}
	}
	if len(active) == 0 {
		return &CommitResult{Allowed: true}, nil
	}

	payload, err := json.Marshal(active)
	if err != nil {
		return nil, fmt.Errorf("marshaling counter entries: %w", err)
	}

	// All keys passed for Redis cluster compat (unused in single-node mode)
	keys := make([]string, len(active))
	for i, e := range active {
		keys[i] = e.Key
	}

	raw, err := luaCommit.Run(ctx, l.rdb, keys, string(payload)).Text()
	if err != nil {
		return nil, fmt.Errorf("executing counter commit: %w", err)
	}

	var cr CommitResult
	if err := json.Unmarshal([]byte(raw), &cr); err != nil {
		return nil, fmt.Errorf("parsing commit result: %w", err)
	}
	return &cr, nil
}

// GetCurrentSpend returns the current value of a counter key (0 when absent).
func (l *Limiter) GetCurrentSpend(ctx context.Context, key string) (float64, error) {
	val, err := l.rdb.Get(ctx, key).Float64()
	if err == redis.Nil {
		return 0, nil
	}
	return val, err
}
