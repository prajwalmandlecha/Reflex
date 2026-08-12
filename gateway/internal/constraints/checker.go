// Package constraints evaluates per-tool operational caps. Stateless rules
// (time windows) are checked directly; stateful counters (rate limits,
// per-parameter spend caps) are expressed as spend.Entry values and committed
// atomically in a single Redis Lua script (see the spend package), so denied
// calls never consume budget (G4) and there is no read-then-write race between
// governance stages.
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

// RateLimit is a per-instance sliding-window rate limit for a tool. The Redis
// counter is keyed by instance ID, so each agent instance has its own budget.
type RateLimit struct {
	MaxCalls      int64 `json:"max_calls"`
	WindowSeconds int64 `json:"window_seconds"`
}

// SharedRateLimit is a hierarchical rate limit scoped to a class or the entire
// fleet. Unlike per-instance rate limits (keyed by instance ID), shared rate
// limits use a Redis key scoped to the class_id or "fleet", so every instance
// that calls the tool contributes to the same counter — a true shared budget.
type SharedRateLimit struct {
	Scope         string `json:"scope"` // "class" | "fleet"
	MaxCalls      int64  `json:"max_calls"`
	WindowSeconds int64  `json:"window_seconds"`
}

// rateLimitEntries builds the sliding-window counter entries for a rate limit
// using the given key/group prefixes. The window is split into 10 sub-buckets
// and the SUM of all live buckets is capped, so a burst straddling a
// fixed-window boundary can't pass 2× max_calls. Each sub-bucket expires after
// one full window, so only the last `window` of calls counts.
func rateLimitEntries(keyPrefix, groupPrefix, scopeLabel, toolName string, maxCalls, winSec int64) []spend.Entry {
	if maxCalls <= 0 {
		return nil
	}
	const subBuckets = 10
	subSec := winSec / subBuckets
	if subSec < 1 {
		subSec = 1
	}
	nowBucket := time.Now().Unix() / subSec
	group := fmt.Sprintf("%s:%s", groupPrefix, toolName)
	var entries []spend.Entry
	for i := int64(0); i < subBuckets; i++ {
		b := nowBucket - i
		amt := 0.0
		if i == 0 {
			amt = 1 // only the current sub-bucket is incremented by this call
		}
		entries = append(entries, spend.Entry{
			Key:        fmt.Sprintf("%s:%s:%d", keyPrefix, toolName, b),
			Amount:     amt,
			Cap:        float64(maxCalls),
			TTLSeconds: winSec,
			Label:      fmt.Sprintf("rate limit exceeded for tool '%s' (%d calls allowed per %ds window across %s)", toolName, maxCalls, winSec, scopeLabel),
			Group:      group,
		})
	}
	return entries
}

// CounterEntries builds the stateful counter increments (sliding-window rate
// limits) for a tool call as spend.Entry values. It emits the per-instance
// rate limit plus any class/fleet-scoped shared rate limits. They are NOT
// applied here — the caller commits them atomically alongside the per-param
// spend caps in one Lua script.
func (c *Checker) CounterEntries(cfg *configcache.AgentConfig, toolName string, args map[string]any) []spend.Entry {
	toolConstraints := toolConstraintsFor(cfg, toolName)
	if toolConstraints == nil {
		return nil
	}

	var entries []spend.Entry

	// 1. Per-instance Sliding Window Rate Limiting
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
			entries = append(entries, rateLimitEntries(
				fmt.Sprintf("ratelimit:%s", cfg.ID),
				fmt.Sprintf("ratelimit-group:%s", cfg.ID),
				fmt.Sprintf("instance '%s'", cfg.ID),
				toolName, maxCalls, winSec,
			)...)
		}
	}

	// 2. Shared (class/fleet) Sliding Window Rate Limiting. Each entry is keyed
	// by class_id or a fixed "fleet" prefix so all instances sharing that scope
	// contribute to the same counter.
	if srlVal, ok := toolConstraints["shared_rate_limits"]; ok {
		if srlArr, ok := srlVal.([]any); ok {
			for _, item := range srlArr {
				m, ok := item.(map[string]any)
				if !ok {
					continue
				}
				scope, _ := m["scope"].(string)
				if scope != "class" && scope != "fleet" {
					continue
				}
				var maxCalls int64
				var winSec int64 = 3600
				if mc, ok := m["max_calls"].(float64); ok {
					maxCalls = int64(mc)
				}
				if ws, ok := m["window_seconds"].(float64); ok {
					winSec = int64(ws)
				}
				if scope == "class" {
					entries = append(entries, rateLimitEntries(
						fmt.Sprintf("ratelimit:class:%s", cfg.ClassID),
						fmt.Sprintf("ratelimit-group:class:%s", cfg.ClassID),
						fmt.Sprintf("class '%s'", cfg.ClassID),
						toolName, maxCalls, winSec,
					)...)
				} else {
					entries = append(entries, rateLimitEntries(
						"ratelimit:fleet",
						"ratelimit-group:fleet",
						"fleet",
						toolName, maxCalls, winSec,
					)...)
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
// accumulation caps (DailyCents, HourlyCents, MonthlyCents). This is the parameter-level
// model: caps are scoped to a specific knob, not a vague tool-wide money sum.
type ParamRule struct {
	Max          float64 `json:"max"`           // per-call ceiling on |value| (major units)
	DailyCents   float64 `json:"daily_cents"`   // accumulated |value| cap per day (cents)
	HourlyCents  float64 `json:"hourly_cents"`  // accumulated |value| cap per hour (cents)
	MonthlyCents float64 `json:"monthly_cents"` // accumulated |value| cap per month (cents)
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
			Max:          toFloat(vm["max"]),
			DailyCents:   toFloat(vm["daily_cents"]),
			HourlyCents:  toFloat(vm["hourly_cents"]),
			MonthlyCents: toFloat(vm["monthly_cents"]),
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

// CheckParamPresence enforces fail-closed behavior for capped parameters. If a
// parameter has ANY cap declared (per-call Max, daily/hourly/monthly
// accumulation, or a shared class/fleet cap), the agent MUST supply that
// parameter in the call with a numeric value. Otherwise the cap could be
// silently bypassed by simply omitting the field (e.g. omitting
// "max_characters" to dodge its ceiling) or by passing a non-numeric value
// that the counter logic would skip. Returns (ok, denyReason).
func (c *Checker) CheckParamPresence(cfg *configcache.AgentConfig, toolName string, args map[string]any) (bool, string) {
	rules := c.ParamRules(cfg, toolName)
	for name, rule := range rules {
		if rule.Max <= 0 && rule.DailyCents <= 0 && rule.HourlyCents <= 0 && rule.MonthlyCents <= 0 {
			continue // no cap declared on this param — presence not required
		}
		v, ok := args[name]
		if !ok {
			return false, fmt.Sprintf("action '%s' denied: parameter '%s' has a cap configured but was omitted from the call — omitting it would bypass the cap", toolName, name)
		}
		if _, ok := toFloatOK(v); !ok {
			return false, fmt.Sprintf("action '%s' denied: parameter '%s' has a cap configured but its value is not numeric — a non-numeric value would bypass the cap", toolName, name)
		}
	}
	for _, sc := range c.SharedCaps(cfg, toolName) {
		v, ok := args[sc.Param]
		if !ok {
			return false, fmt.Sprintf("action '%s' denied: parameter '%s' has a shared %s cap configured but was omitted from the call — omitting it would bypass the cap", toolName, sc.Param, sc.Scope)
		}
		if _, ok := toFloatOK(v); !ok {
			return false, fmt.Sprintf("action '%s' denied: parameter '%s' has a shared %s cap configured but its value is not numeric — a non-numeric value would bypass the cap", toolName, sc.Param, sc.Scope)
		}
	}
	return true, ""
}

// ParamCounterEntries builds the stateful per-parameter accumulation counters
// (daily/hourly/monthly) as spend.Entry values. Each declared param with a daily,
// hourly, or monthly cap produces its own counter keyed by tool+param+window, so caps are
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
		// A param named *_cents is already in cents (no ×100); major-unit
		// params are dollars and must be converted to cents. This must match
		// SharedCapEntries and ExtractAmountCents exactly.
		cents := abs(f) * 100.0
		if strings.HasSuffix(name, "_cents") {
			cents = abs(f)
		}
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
		if rule.MonthlyCents > 0 {
			month := now.Format("2006-01")
			entries = append(entries, spend.Entry{
				Key:        fmt.Sprintf("paramcap:%s:%s:%s:%s", cfg.ID, toolName, name, month),
				Amount:     cents,
				Cap:        rule.MonthlyCents,
				TTLSeconds: 5356800, // 62 days
				Label:      fmt.Sprintf("monthly cap exceeded for parameter '%s' on tool '%s' ($%.2f monthly cap)", name, toolName, rule.MonthlyCents/100.0),
			})
		}
	}
	return entries
}

// SharedCap is a hierarchical spend cap scoped to a tool+parameter combination
// but shared across all instances in a class or the entire fleet. Unlike
// per-instance ParamRule counters (keyed by instance ID), shared caps use a
// Redis key scoped to the class_id or "fleet", so every instance that calls the
// tool contributes to the same counter.
type SharedCap struct {
	Scope      string  `json:"scope"`       // "class" | "fleet"
	Param      string  `json:"param"`       // must match a key in the tool's params
	Window     string  `json:"window"`      // "daily" | "hourly" | "monthly"
	LimitCents float64 `json:"limit_cents"` // cap in cents
}

// SharedCaps returns the shared (class/fleet-scoped) parameter caps declared for
// a tool. Empty when the tool has no shared caps configured.
func (c *Checker) SharedCaps(cfg *configcache.AgentConfig, toolName string) []SharedCap {
	tc := toolConstraintsFor(cfg, toolName)
	if tc == nil {
		return nil
	}
	raw, ok := tc["shared_caps"]
	if !ok {
		return nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	var out []SharedCap
	for _, item := range arr {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		scope, _ := m["scope"].(string)
		param, _ := m["param"].(string)
		window, _ := m["window"].(string)
		limitCents := toFloat(m["limit_cents"])
		if scope == "" || param == "" || window == "" || limitCents <= 0 {
			continue
		}
		if scope != "class" && scope != "fleet" {
			continue
		}
		if window != "daily" && window != "hourly" && window != "monthly" {
			continue
		}
		out = append(out, SharedCap{
			Scope:      scope,
			Param:      param,
			Window:     window,
			LimitCents: limitCents,
		})
	}
	return out
}

// SharedCapEntries builds stateful spend.Entry values for class-wide or
// fleet-wide parameter caps. The Redis key uses the class_id (class scope) or
// a fixed "fleet" prefix (fleet scope) so all instances sharing that scope
// contribute to the same counter. Committed atomically alongside per-instance
// counters by the caller.
func (c *Checker) SharedCapEntries(cfg *configcache.AgentConfig, toolName string, args map[string]any) []spend.Entry {
	caps := c.SharedCaps(cfg, toolName)
	if len(caps) == 0 {
		return nil
	}
	var entries []spend.Entry
	now := time.Now().UTC()
	for _, sc := range caps {
		v, ok := args[sc.Param]
		if !ok {
			continue
		}
		f, ok := toFloatOK(v)
		if !ok {
			continue
		}
		cents := abs(f) * 100.0
		if strings.HasSuffix(sc.Param, "_cents") {
			cents = abs(f)
		}
		if cents <= 0 {
			continue
		}

		var bucket string
		var ttl int64
		if sc.Window == "daily" {
			bucket = now.Format("2006-01-02")
			ttl = 172800 // 48h
		} else if sc.Window == "hourly" {
			bucket = now.Format("2006010215")
			ttl = 172800
		} else if sc.Window == "monthly" {
			bucket = now.Format("2006-01")
			ttl = 5356800 // 62 days
		}

		var key, scopeLabel string
		if sc.Scope == "class" {
			key = fmt.Sprintf("sharedcap:class:%s:%s:%s:%s", cfg.ClassID, toolName, sc.Param, bucket)
			scopeLabel = fmt.Sprintf("class '%s'", cfg.ClassID)
		} else {
			key = fmt.Sprintf("sharedcap:fleet:%s:%s:%s", toolName, sc.Param, bucket)
			scopeLabel = "fleet"
		}

		entries = append(entries, spend.Entry{
			Key:        key,
			Amount:     cents,
			Cap:        sc.LimitCents,
			TTLSeconds: ttl,
			Label:      fmt.Sprintf("%s %s cap exceeded for parameter '%s' on tool '%s' ($%.2f %s cap across %s)", sc.Scope, sc.Window, sc.Param, toolName, sc.LimitCents/100.0, sc.Window, scopeLabel),
		})
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
// If the tool has parameter-level caps declared in cfg, ExtractAmountCents
// inspects the call's args for those parameter names and returns their summed
// monetary value in cents (handling _cents suffix vs major units). If no param
// rules match, it falls back to the legacy heuristic (`amount_cents` in cents,
// `amount` in major units).
func (c *Checker) ExtractAmountCents(cfg *configcache.AgentConfig, toolName string, args map[string]any) (cents float64, found bool) {
	if args == nil {
		return 0, false
	}
	rules := c.ParamRules(cfg, toolName)
	if len(rules) > 0 {
		var totalCents float64
		var anyFound bool
		for name := range rules {
			if v, ok := args[name]; ok {
				if f, ok := toFloatOK(v); ok {
					anyFound = true
					if strings.HasSuffix(name, "_cents") {
						totalCents += abs(f)
					} else {
						totalCents += abs(f) * 100.0
					}
				}
			}
		}
		if anyFound {
			return totalCents, true
		}
	}

	if v, ok := args["amount_cents"]; ok {
		if f, ok := toFloatOK(v); ok {
			return abs(f), true
		}
	}
	if v, ok := args["amount"]; ok {
		if f, ok := toFloatOK(v); ok {
			return abs(f) * 100.0, true
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
