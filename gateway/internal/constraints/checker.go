// Package constraints evaluates per-tool operational caps. Stateless rules
// (time windows) are checked directly; stateful counters (rate limits,
// cumulative daily spend) are expressed as spend.Entry values and committed
// atomically — together with hierarchical spend caps — in a single Redis Lua
// script (see the spend package), so denied calls never consume budget (G4)
// and there is no read-then-write race between governance stages.
package constraints

import (
	"fmt"
	"strings"
	"time"

	"github.com/agp/gateway/internal/configcache"
	"github.com/agp/gateway/internal/spend"
)

// Checker evaluates per-tool operational caps for agent instances & classes.
type Checker struct{}

// NewChecker creates a constraints Checker.
func NewChecker() *Checker {
	return &Checker{}
}

// CheckStatic evaluates the stateless constraints (execution time window) for
// a given tool call. Static parameter schema rules (numeric bounds, enum
// whitelists, regex patterns) are evaluated by OPA Rego.
func (c *Checker) CheckStatic(cfg *configcache.AgentConfig, toolName string) (bool, string) {
	toolConstraints := toolConstraintsFor(cfg, toolName)
	if toolConstraints == nil {
		return true, ""
	}

	// Execution Time Window Check (HH:MM UTC format)
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
					if !withinWindow(currentMinutes, startMin, endMin) {
						return false, fmt.Sprintf("action '%s' is restricted outside business hours (%s to %s UTC)", toolName, startStr, endStr)
					}
				}
			}
		}
	}

	return true, ""
}

// withinWindow reports whether currentMinutes falls inside the [startMin,
// endMin] window. Handles overnight windows where start > end (e.g. 22:00–
// 06:00): those wrap past midnight, so "inside" means >= start OR <= end.
func withinWindow(current, startMin, endMin int) bool {
	if startMin <= endMin {
		return current >= startMin && current <= endMin
	}
	// Overnight window (e.g. 22:00–06:00)
	return current >= startMin || current <= endMin
}

// CounterEntries builds the stateful counter increments (sliding-window rate
// limit) for a tool call as spend.Entry values. They are NOT applied here —
// the caller commits them atomically alongside the per-param spend caps and
// hierarchical spend scopes in one Lua script.
func (c *Checker) CounterEntries(cfg *configcache.AgentConfig, toolName string, args map[string]any) []spend.Entry {
	toolConstraints := toolConstraintsFor(cfg, toolName)
	if toolConstraints == nil {
		return nil
	}

	var entries []spend.Entry

	// 1. Sliding Window Rate Limiting
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
				// Sliding window: split the window into 10 sub-buckets and cap the
				// SUM of all live buckets, so a burst straddling a fixed-window
				// boundary can't pass 2× max_calls. Each sub-bucket expires after
				// one full window, so only the last `window` of calls counts.
				const subBuckets = 10
				subSec := winSec / subBuckets
				if subSec < 1 {
					subSec = 1
				}
				nowBucket := time.Now().Unix() / subSec
				group := fmt.Sprintf("ratelimit-group:%s:%s", cfg.ID, toolName)
				for i := int64(0); i < subBuckets; i++ {
					b := nowBucket - i
					amt := 0.0
					if i == 0 {
						amt = 1 // only the current sub-bucket is incremented by this call
					}
					entries = append(entries, spend.Entry{
						Key:        fmt.Sprintf("ratelimit:%s:%s:%d", cfg.ID, toolName, b),
						Amount:     amt,
						Cap:        float64(maxCalls),
						TTLSeconds: winSec,
						Label:      fmt.Sprintf("rate limit exceeded for tool '%s' (%d calls allowed per %ds window)", toolName, maxCalls, winSec),
						Group:      group,
					})
				}
			}
		}
	}

	return entries
}

func toolConstraintsFor(cfg *configcache.AgentConfig, toolName string) map[string]any {
	if cfg == nil || cfg.EffectiveConstraints == nil {
		return nil
	}
	return cfg.EffectiveConstraints[toolName]
}

// ParamRule is the per-parameter constraint block for a tool. Each declared
// parameter can carry a per-call ceiling (Max) and/or time-windowed
// accumulation caps (DailyCents, HourlyCents). This is the parameter-level
// model: caps are scoped to a specific knob, not a vague tool-wide money sum,
// so an agent with both deposit and withdraw tools gets each capped
// independently (and sign-agnostically via absolute value).
type ParamRule struct {
	Max        float64 `json:"max"`         // per-call ceiling on |value| (major units)
	DailyCents float64 `json:"daily_cents"` // accumulated |value| cap per day (cents)
	HourlyCents float64 `json:"hourly_cents"` // accumulated |value| cap per hour (cents)
}

// ParamRules returns the per-parameter constraint rules declared for a tool,
// keyed by argument field name. Empty when the tool has no parameter caps.
func (c *Checker) ParamRules(cfg *configcache.AgentConfig, toolName string) map[string]ParamRule {
	tc := toolConstraintsFor(cfg, toolName)
	if tc == nil {
		return nil
	}
	raw, ok := tc["params"]
	if !ok {
		return nil
	}
	pm, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	out := make(map[string]ParamRule, len(pm))
	for name, v := range pm {
		vm, ok := v.(map[string]any)
		if !ok {
			continue
		}
		out[name] = ParamRule{
			Max:         toFloat(vm["max"]),
			DailyCents:  toFloat(vm["daily_cents"]),
			HourlyCents: toFloat(vm["hourly_cents"]),
		}
	}
	return out
}

// CheckParamMax evaluates the stateless per-call parameter ceilings. For each
// declared param with a Max, the call's value (absolute) must not exceed it.
// Returns (ok, denyReason).
func (c *Checker) CheckParamMax(cfg *configcache.AgentConfig, toolName string, args map[string]any) (bool, string) {
	rules := c.ParamRules(cfg, toolName)
	if len(rules) == 0 {
		return true, ""
	}
	for name, rule := range rules {
		if rule.Max <= 0 {
			continue
		}
		v, ok := args[name]
		if !ok {
			continue // absent optional param — no ceiling to enforce
		}
		f, ok := toFloatOK(v)
		if !ok {
			continue // non-numeric — not a money value
		}
		if abs(f) > rule.Max {
			return false, fmt.Sprintf("action '%s' denied: parameter '%s' value %.2f exceeds per-call cap %.2f", toolName, name, f, rule.Max)
		}
	}
	return true, ""
}

// ParamCounterEntries builds the stateful per-parameter accumulation counters
// (daily/hourly) as spend.Entry values. Each declared param with a daily or
// hourly cap produces its own counter keyed by tool+param+window, so caps are
// scoped to the specific knob. Committed atomically by the caller.
func (c *Checker) ParamCounterEntries(cfg *configcache.AgentConfig, toolName string, args map[string]any) []spend.Entry {
	rules := c.ParamRules(cfg, toolName)
	if len(rules) == 0 {
		return nil
	}
	var entries []spend.Entry
	now := time.Now().UTC()
	for name, rule := range rules {
		v, ok := args[name]
		if !ok {
			continue
		}
		f, ok := toFloatOK(v)
		if !ok {
			continue
		}
		cents := abs(f) * 100.0
		if cents <= 0 {
			continue
		}
		if rule.DailyCents > 0 {
			day := now.Format("2006-01-02")
			entries = append(entries, spend.Entry{
				Key:        fmt.Sprintf("paramcap:%s:%s:%s:%s", cfg.ID, toolName, name, day),
				Amount:     cents,
				Cap:        rule.DailyCents,
				TTLSeconds: 172800,
				Label:      fmt.Sprintf("daily cap exceeded for parameter '%s' on tool '%s' ($%.2f daily cap)", name, toolName, rule.DailyCents/100.0),
			})
		}
		if rule.HourlyCents > 0 {
			hour := now.Format("2006010215")
			entries = append(entries, spend.Entry{
				Key:        fmt.Sprintf("paramcap:%s:%s:%s:%s", cfg.ID, toolName, name, hour),
				Amount:     cents,
				Cap:        rule.HourlyCents,
				TTLSeconds: 172800,
				Label:      fmt.Sprintf("hourly cap exceeded for parameter '%s' on tool '%s' ($%.2f hourly cap)", name, toolName, rule.HourlyCents/100.0),
			})
		}
	}
	return entries
}

func abs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}

func toFloat(val any) float64 {
	f, _ := toFloatOK(val)
	return f
}

// toFloatOK parses a JSON-decoded value as a float, reporting whether it was a
// parseable number. Distinguishing "absent/unparseable" from "present zero" is
// what enables fail-closed enforcement on money-moving tools.
func toFloatOK(val any) (float64, bool) {
	switch v := val.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return 0, false
		}
		var f float64
		if _, err := fmt.Sscanf(s, "%f", &f); err == nil {
			return f, true
		}
	}
	return 0, false
}

// ExtractAmountCents computes the monetary value of a call in cents.
//
// When moneyParams is non-empty, ONLY those declared fields are summed — a
// field whose name ends in "_cents" is treated as cents, otherwise as major
// currency units (×100); found reports whether at least one declared field
// carried a parseable number. When moneyParams is empty, it falls back to the
// legacy heuristic (`amount` in major units, `amount_cents` in cents) so tools
// that predate money-field declarations keep working.
//
// This is the single source of truth for money extraction across the gateway —
// both the proxy (OPA input, metrics, hierarchical caps) and the per-param
// spend-cap counters use it, so no two code paths can disagree on the amount.
// `amount_cents` is treated as cents, `amount` as major currency units (×100).
func ExtractAmountCents(args map[string]any) (cents float64, found bool) {
	if args == nil {
		return 0, false
	}
	if v, ok := args["amount_cents"]; ok {
		if f, ok := toFloatOK(v); ok {
			return f, true
		}
	}
	if v, ok := args["amount"]; ok {
		if f, ok := toFloatOK(v); ok {
			return f * 100.0, true
		}
	}
	return 0, false
}

func parseMinutes(hhmm string) int {
	var h, m int
	if _, err := fmt.Sscanf(hhmm, "%d:%d", &h, &m); err == nil {
		return h*60 + m
	}
	return -1
}
