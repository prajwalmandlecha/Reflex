// Package constraints evaluates stateful operational & dynamic caps (rate limits, cumulative daily spend caps, time windows).
package constraints

import (
	"context"
	"fmt"
	"time"

	"github.com/agp/gateway/internal/configcache"
	"github.com/redis/go-redis/v9"
)

// Checker evaluates stateful operational caps (rate limits, cumulative spend, time windows) for agent instances & classes.
type Checker struct {
	rdb *redis.Client
}

// NewChecker creates a constraints Checker backed by Redis for sliding window rate-limiting and cumulative spend counters.
func NewChecker(rdb *redis.Client) *Checker {
	return &Checker{rdb: rdb}
}

// Check evaluates stateful runtime operational caps for a given tool call.
// Static parameter schema rules (numeric bounds, enum whitelists, regex patterns) are evaluated by OPA Rego.
//
// commit controls whether stateful counters (rate limit, cumulative spend) are
// actually incremented. Pass commit=false for the early governance gate (a
// read-only "would this exceed?" check), and commit=true only AFTER all other
// governance stages have passed — so denied calls never consume budget (G4).
func (c *Checker) Check(ctx context.Context, cfg *configcache.AgentConfig, toolName string, args map[string]any, commit bool) (bool, string) {
	if cfg == nil || cfg.EffectiveConstraints == nil {
		return true, ""
	}

	toolConstraints, exists := cfg.EffectiveConstraints[toolName]
	if !exists || toolConstraints == nil {
		return true, ""
	}

	// 1. Sliding Window Rate Limiting (Redis INCR with TTL)
	if rlVal, ok := toolConstraints["rate_limit"]; ok {
		if rlMap, ok := rlVal.(map[string]any); ok {
			var maxCalls int64
			var winSec int64 = 3600
			if mc, ok := rlMap["max_calls"].(float64); ok {
				maxCalls = int64(mc)
			}
			if ws, ok := rlMap["window_seconds"].(float64); ok {
				winSec = int64(ws)
			}

			if maxCalls > 0 {
				key := fmt.Sprintf("ratelimit:%s:%s:%d", cfg.ID, toolName, time.Now().Unix()/winSec)
				if commit {
					cnt, err := c.rdb.Incr(ctx, key).Result()
					if err == nil {
						if cnt == 1 {
							c.rdb.Expire(ctx, key, time.Duration(winSec)*time.Second)
						}
						if cnt > maxCalls {
							return false, fmt.Sprintf("rate limit exceeded for tool '%s' (%d / %d calls allowed per %ds window)", toolName, cnt, maxCalls, winSec)
						}
					}
				} else {
					// Dry-run: read current count without incrementing.
					cur, err := c.rdb.Get(ctx, key).Int64()
					if err != nil && err != redis.Nil {
						// On Redis error, fail open for the dry-run (commit will re-check).
						cur = 0
					}
					if cur+1 > maxCalls {
						return false, fmt.Sprintf("rate limit exceeded for tool '%s' (%d / %d calls allowed per %ds window)", toolName, cur+1, maxCalls, winSec)
					}
				}
			}
		}
	}

	// 2. Cumulative Daily Spend Cap (Sliding 24-Hour Aggregate Monetary Limit)
	if spendVal, ok := toolConstraints["cumulative_spend_cap"]; ok {
		if spendMap, ok := spendVal.(map[string]any); ok {
			maxDailyCap := toFloat(spendMap["max_daily_cents"])
			if maxDailyCap > 0 {
				// Extract monetary amount in current call (handles float/int/string).
				currentCallCents := amountCentsFromArgs(args)

				if currentCallCents > 0 {
					dayBucket := time.Now().UTC().Format("2006-01-02")
					key := fmt.Sprintf("spendcap:%s:%s", cfg.ID, dayBucket)
					if commit {
						newTotal, err := c.rdb.IncrByFloat(ctx, key, currentCallCents).Result()
						if err == nil {
							if newTotal == currentCallCents {
								c.rdb.Expire(ctx, key, 48*time.Hour)
							}
							if newTotal > maxDailyCap {
								return false, fmt.Sprintf("cumulative daily spend cap exceeded for agent '%s' ($%.2f spent / $%.2f daily cap limit)", cfg.ID, newTotal/100.0, maxDailyCap/100.0)
							}
						}
					} else {
						// Dry-run: read current total without incrementing.
						cur, err := c.rdb.Get(ctx, key).Float64()
						if err != nil && err != redis.Nil {
							cur = 0
						}
						if cur+currentCallCents > maxDailyCap {
							return false, fmt.Sprintf("cumulative daily spend cap exceeded for agent '%s' ($%.2f spent / $%.2f daily cap limit)", cfg.ID, (cur+currentCallCents)/100.0, maxDailyCap/100.0)
						}
					}
				}
			}
		}
	}

	// 3. Execution Time Window Check (HH:MM UTC format)
	if twVal, ok := toolConstraints["time_window"]; ok {
		if twMap, ok := twVal.(map[string]any); ok {
			startStr, _ := twMap["start"].(string)
			endStr, _ := twMap["end"].(string)

			if startStr != "" && endStr != "" {
				now := time.Now().UTC()
				currentMinutes := now.Hour()*60 + now.Minute()

				startMin := parseMinutes(startStr)
				endMin := parseMinutes(endStr)

				if startMin >= 0 && endMin >= 0 {
					if currentMinutes < startMin || currentMinutes > endMin {
						return false, fmt.Sprintf("action '%s' is restricted outside business hours (%s to %s UTC)", toolName, startStr, endStr)
					}
				}
			}
		}
	}

	return true, ""
}

func toFloat(val any) float64 {
	switch v := val.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case string:
		var f float64
		if _, err := fmt.Sscanf(v, "%f", &f); err == nil {
			return f
		}
	}
	return 0.0
}

// amountCentsFromArgs extracts the monetary amount of a call in cents,
// accepting `amount_cents` (used as-is) or `amount` (dollars, ×100), each as
// float, int, or numeric string. Returns 0 when no parseable amount is present.
func amountCentsFromArgs(args map[string]any) float64 {
	if args == nil {
		return 0
	}
	if v, ok := args["amount_cents"]; ok {
		if f := toFloat(v); f > 0 {
			return f
		}
	}
	if v, ok := args["amount"]; ok {
		if f := toFloat(v); f > 0 {
			return f * 100.0
		}
	}
	return 0
}

func parseMinutes(hhmm string) int {
	var h, m int
	if _, err := fmt.Sscanf(hhmm, "%d:%d", &h, &m); err == nil {
		return h*60 + m
	}
	return -1
}
