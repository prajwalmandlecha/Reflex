// Package spend provides atomic enforcement of ALL stateful governance counters
// (per-parameter spend caps, per-tool rate limits) via a single Redis Lua script.
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
//
// Group is optional: entries sharing the same Group are capped on the SUM of
// their keys rather than individually. This is how the sliding-window rate
// limiter caps the total across all live sub-buckets instead of each bucket.
type Entry struct {
	Key        string  `json:"key"`
	Amount     float64 `json:"amount"`
	Cap        float64 `json:"cap"`
	TTLSeconds int64   `json:"ttl"`
	Label      string  `json:"label,omitempty"` // human-readable description used in deny reasons
	Group      string  `json:"group,omitempty"` // when set, Cap applies to the sum of all keys in the group
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

-- First pass: apply increments and collect per-group caps/keys.
local group_caps = {}
local group_labels = {}
local group_keys_order = {}

for i, e in ipairs(entries) do
    local new_val = 0
    -- Skip zero-amount entries for the increment: the sliding-window rate
    -- limiter emits 9 zero-amount sub-bucket entries purely to register their
    -- keys in the group for summing. INCRBYFLOAT 0 would CREATE those keys
    -- (Redis creates a key on INCRBYFLOAT even with 0), so skipping them avoids
    -- 9 wasted key creations per call. They still register in the group below.
    if e.amount ~= 0 then
        new_val = tonumber(redis.call('INCRBYFLOAT', e.key, e.amount))
        table.insert(applied, e)
        -- Set a TTL on first creation so windowed counters don't leak forever (G13).
        if new_val == e.amount and e.ttl > 0 then
            redis.call('EXPIRE', e.key, e.ttl)
        end
    end

    if e.group and e.group ~= "" then
        -- Grouped entry: cap applies to the SUM of all keys in the group.
        if not group_caps[e.group] then
            group_caps[e.group] = e.cap
            group_labels[e.group] = e.label
            group_keys_order[e.group] = {}
        end
        table.insert(group_keys_order[e.group], e.key)
    else
        -- Ungrouped entry: cap applies to this key alone.
        if e.cap > 0 and new_val > e.cap then
            for _, a in ipairs(applied) do
                redis.call('INCRBYFLOAT', a.key, -a.amount)
            end
            return cjson.encode({allowed=false, exceeded=e.key, label=e.label, current=new_val - e.amount, cap=e.cap})
        end
    end
end

-- Second pass: enforce per-group caps on the summed values. GET on a
-- never-created sub-bucket key returns nil -> 0, which is correct (that bucket
-- has no calls). Only the current sub-bucket is ever incremented, so at most
-- window/sub_buckets distinct keys are live at once.
for group, cap in pairs(group_caps) do
    if cap > 0 then
        local sum = 0
        for _, k in ipairs(group_keys_order[group]) do
            sum = sum + tonumber(redis.call('GET', k) or 0)
        end
        if sum > cap then
            for _, a in ipairs(applied) do
                redis.call('INCRBYFLOAT', a.key, -a.amount)
            end
            return cjson.encode({allowed=false, exceeded=group, label=group_labels[group], current=sum - 1, cap=cap})
        end
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
//
// Entries with a non-positive Amount are kept when they carry a Group: the
// sliding-window rate limiter emits 10 sub-bucket entries where only the
// current bucket has Amount=1 and the other 9 have Amount=0. Those zero-amount
// entries exist solely to register their keys in the group so the Lua script
// can sum the FULL window (all live sub-buckets) against the cap. Dropping them
// would shrink the group to the current sub-bucket and let a burst straddling a
// sub-bucket boundary bypass the rate limit. Only true no-ops (Amount<=0 AND no
// group) are skipped.
func (l *Limiter) Commit(ctx context.Context, entries []Entry) (*CommitResult, error) {
	active := make([]Entry, 0, len(entries))
	for _, e := range entries {
		if e.Amount > 0 || e.Group != "" {
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

// luaRollback decrements every counter by the given amounts — the exact inverse
// of luaCommit's increments. Used to refund budget when a downstream call fails
// AFTER the governance counters were committed, so a failed bank call never
// consumes spend/rate-limit budget.
var luaRollback = redis.NewScript(`
local entries = cjson.decode(ARGV[1])
for i, e in ipairs(entries) do
    redis.call('INCRBYFLOAT', e.key, -e.amount)
end
return cjson.encode({rolled_back=#entries})
`)

// Rollback decrements every entry's counter by its amount, undoing a prior
// Commit. Best-effort by design: a rollback failure is logged by the caller,
// not retried, since the counters are windowed and self-expire via TTL.
func (l *Limiter) Rollback(ctx context.Context, entries []Entry) error {
	active := make([]Entry, 0, len(entries))
	for _, e := range entries {
		if e.Amount > 0 {
			active = append(active, e)
		}
	}
	if len(active) == 0 {
		return nil
	}

	payload, err := json.Marshal(active)
	if err != nil {
		return fmt.Errorf("marshaling rollback entries: %w", err)
	}

	keys := make([]string, len(active))
	for i, e := range active {
		keys[i] = e.Key
	}

	if err := luaRollback.Run(ctx, l.rdb, keys, string(payload)).Err(); err != nil {
		return fmt.Errorf("executing counter rollback: %w", err)
	}
	return nil
}
