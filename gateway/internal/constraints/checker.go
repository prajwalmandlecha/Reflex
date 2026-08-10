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
// limit, cumulative daily spend cap) for a tool call as spend.Entry values.
// They are NOT applied here — the caller commits them atomically alongside
// the hierarchical spend scopes in one Lua script.
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

	// 2. Cumulative Daily Spend Cap (Sliding 24-Hour Aggregate Monetary Limit)
	if spendVal, ok := toolConstraints["cumulative_spend_cap"]; ok {
		if spendMap, ok := spendVal.(map[string]any); ok {
			maxDailyCap := toFloat(spendMap["max_daily_cents"])
			if maxDailyCap > 0 {
				// Extract the monetary amount using the tool's DECLARED money
				// fields (falls back to amount/amount_cents when none declared).
				currentCallCents, _ := ExtractAmountCents(args, moneyParamsFrom(toolConstraints))
				if currentCallCents > 0 {
					dayBucket := time.Now().UTC().Format("2006-01-02")
					entries = append(entries, spend.Entry{
						Key:        fmt.Sprintf("spendcap:%s:%s", cfg.ID, dayBucket),
						Amount:     currentCallCents,
						Cap:        maxDailyCap,
						TTLSeconds: 172800, // 48h comfortably covers the daily bucket
						Label:      fmt.Sprintf("cumulative daily spend cap exceeded for agent '%s' ($%.2f daily cap limit)", cfg.ID, maxDailyCap/100.0),
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

// MoneyParams returns the argument field names a tool has declared as carrying
// monetary value (e.g. ["amount_cents"], ["attendee_share"]). Empty when the
// tool has no declaration.
func (c *Checker) MoneyParams(cfg *configcache.AgentConfig, toolName string) []string {
	return moneyParamsFrom(toolConstraintsFor(cfg, toolName))
}

// RequiresAmount reports whether a tool is money-moving and therefore MUST
// carry a parseable monetary value: true when it declares money_params or
// configures a cumulative_spend_cap. The declared money fields are returned so
// callers can produce a precise deny reason. This is what lets the gateway fail
// closed instead of silently treating an unrecognized field as $0 spend.
//
// Schema-aware: a declared money field that is OPTIONAL in the tool's input
// schema does NOT force fail-closed — a legitimate call may omit it (e.g. a
// "scale" multiplier). Only REQUIRED money fields (or an unknown schema, which
// we treat conservatively) fail closed when missing.
func (c *Checker) RequiresAmount(cfg *configcache.AgentConfig, toolName string) (bool, []string) {
	tc := toolConstraintsFor(cfg, toolName)
	if tc == nil {
		return false, nil
	}
	mp := moneyParamsFrom(tc)
	if len(mp) > 0 {
		return c.moneyFieldRequired(cfg, toolName, mp), mp
	}
	if sc, ok := tc["cumulative_spend_cap"].(map[string]any); ok {
		if toFloat(sc["max_daily_cents"]) > 0 {
			return true, mp
		}
	}
	return false, mp
}

// moneyFieldRequired reports whether any declared money field is REQUIRED in
// the tool's input schema. When the schema is unknown (no propagated schema),
// it conservatively returns true so the gateway keeps failing closed rather
// than silently metering $0.
func (c *Checker) moneyFieldRequired(cfg *configcache.AgentConfig, toolName string, moneyParams []string) bool {
	if cfg == nil || cfg.ToolSchemas == nil {
		return true
	}
	ts, ok := cfg.ToolSchemas[toolName]
	if !ok {
		return true // unknown schema → conservative fail-closed
	}
	req := make(map[string]bool, len(ts.Required))
	for _, f := range ts.Required {
		req[f] = true
	}
	for _, f := range moneyParams {
		if req[f] {
			return true
		}
	}
	return false
}

// moneyParamsFrom extracts the declared money_params string list from a tool's
// constraint map, tolerating the []any shape produced by JSON decoding.
func moneyParamsFrom(tc map[string]any) []string {
	if tc == nil {
		return nil
	}
	raw, ok := tc["money_params"]
	if !ok {
		return nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, x := range arr {
		if s, ok := x.(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
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
// both the proxy (OPA input, metrics, hierarchical caps) and the cumulative
// spend-cap counter use it, so no two code paths can disagree on the amount.
func ExtractAmountCents(args map[string]any, moneyParams []string) (cents float64, found bool) {
	if args == nil {
		return 0, false
	}
	if len(moneyParams) > 0 {
		for _, field := range moneyParams {
			v, ok := args[field]
			if !ok {
				continue
			}
			f, ok := toFloatOK(v)
			if !ok {
				continue
			}
			found = true
			if strings.HasSuffix(field, "_cents") {
				cents += f
			} else {
				cents += f * 100.0
			}
		}
		return cents, found
	}
	// Legacy fallback (no declared money fields).
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
