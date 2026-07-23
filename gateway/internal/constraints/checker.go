// Package constraints evaluates dynamic per-tool constraints (numeric bounds, allowed/forbidden values, regex deny/allow, path traversal, rate limits, time windows).
package constraints

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/agp/gateway/internal/configcache"
	"github.com/redis/go-redis/v9"
)

// Checker evaluates per-tool constraints defined on agent classes and instances.
type Checker struct {
	rdb *redis.Client
}

// NewChecker creates a constraints Checker backed by Redis for rate-limiting counters.
func NewChecker(rdb *redis.Client) *Checker {
	return &Checker{rdb: rdb}
}

// Check evaluates all defined constraints for a given tool call across ANY domain (financial, DB, File, API, Admin, LLM).
// Returns (allowed, denyReason).
func (c *Checker) Check(ctx context.Context, cfg *configcache.AgentConfig, toolName string, args map[string]any) (bool, string) {
	if cfg == nil || cfg.EffectiveConstraints == nil {
		return true, ""
	}

	toolConstraints, exists := cfg.EffectiveConstraints[toolName]
	if !exists || toolConstraints == nil {
		return true, ""
	}

	// 1. Backward-compatible Legacy max_amount Check
	if maxAmtVal, ok := toolConstraints["max_amount"]; ok {
		maxAmt := toFloat(maxAmtVal)
		if maxAmt > 0 {
			var amt float64
			if a, ok := args["amount"].(float64); ok {
				amt = a
			} else if aCents, ok := args["amount_cents"].(float64); ok {
				amt = aCents / 100.0
			}
			if amt > maxAmt {
				return false, fmt.Sprintf("amount $%.2f exceeds maximum allowed single-transaction parameter bound of $%.2f for tool '%s'", amt, maxAmt, toolName)
			}
		}
	}

	// 2. Generic Parameter Numeric Bounds: { "param_name": { "max": 100, "min": 1 } }
	if boundsVal, ok := toolConstraints["numeric_bounds"]; ok {
		if boundsMap, ok := boundsVal.(map[string]any); ok {
			for paramName, specVal := range boundsMap {
				if spec, ok := specVal.(map[string]any); ok {
					if argVal, exists := args[paramName]; exists {
						num := toFloat(argVal)
						if maxVal, hasMax := spec["max"]; hasMax && num > toFloat(maxVal) {
							return false, fmt.Sprintf("parameter '%s' value %.2f exceeds maximum bound of %.2f for tool '%s'", paramName, num, toFloat(maxVal), toolName)
						}
						if minVal, hasMin := spec["min"]; hasMin && num < toFloat(minVal) {
							return false, fmt.Sprintf("parameter '%s' value %.2f is below minimum bound of %.2f for tool '%s'", paramName, num, toFloat(minVal), toolName)
						}
					}
				}
			}
		}
	}

	// 3. Generic Allowed Values List: { "param_name": ["val1", "val2"] } (supports currency, database, environment, format, etc.)
	if allowedVal, ok := toolConstraints["allowed_values"]; ok {
		if allowedMap, ok := allowedVal.(map[string]any); ok {
			for paramName, listVal := range allowedMap {
				if allowedList, ok := listVal.([]any); ok && len(allowedList) > 0 {
					if argVal, exists := args[paramName]; exists {
						strVal := fmt.Sprintf("%v", argVal)
						matched := false
						for _, item := range allowedList {
							if fmt.Sprintf("%v", item) == strVal {
								matched = true
								break
							}
						}
						if !matched {
							return false, fmt.Sprintf("parameter '%s' value '%s' is not in allowed values list %v for tool '%s'", paramName, strVal, allowedList, toolName)
						}
					}
				}
			}
		}
	}

	// 4. Backward-compatible Legacy allowed_currencies Check
	if currVal, ok := toolConstraints["allowed_currencies"]; ok {
		if allowedList, ok := currVal.([]any); ok && len(allowedList) > 0 {
			if reqCurr, ok := args["currency"].(string); ok && reqCurr != "" {
				matched := false
				for _, allowed := range allowedList {
					if fmt.Sprintf("%v", allowed) == reqCurr {
						matched = true
						break
					}
				}
				if !matched {
					return false, fmt.Sprintf("currency '%s' is not in allowed currencies list for tool '%s'", reqCurr, toolName)
				}
			}
		}
	}

	// 5. Generic Forbidden Values List: { "param_name": ["forbidden1", "forbidden2"] }
	if forbiddenVal, ok := toolConstraints["forbidden_values"]; ok {
		if forbiddenMap, ok := forbiddenVal.(map[string]any); ok {
			for paramName, listVal := range forbiddenMap {
				if forbiddenList, ok := listVal.([]any); ok && len(forbiddenList) > 0 {
					if argVal, exists := args[paramName]; exists {
						strVal := fmt.Sprintf("%v", argVal)
						for _, item := range forbiddenList {
							if strings.EqualFold(fmt.Sprintf("%v", item), strVal) {
								return false, fmt.Sprintf("parameter '%s' value '%s' is explicitly forbidden for tool '%s'", paramName, strVal, toolName)
							}
						}
					}
				}
			}
		}
	}

	// 6. Generic Regex Deny Rules (e.g. SQL Injection prevention, path traversal, dangerous patterns): { "param_name": "(?i)(DROP|DELETE|ALTER|TRUNCATE|..)" }
	if regexDenyVal, ok := toolConstraints["regex_deny"]; ok {
		if regexMap, ok := regexDenyVal.(map[string]any); ok {
			for paramName, patternVal := range regexMap {
				if patternStr, ok := patternVal.(string); ok && patternStr != "" {
					if argVal, exists := args[paramName]; exists {
						strVal := fmt.Sprintf("%v", argVal)
						if matched, _ := regexp.MatchString(patternStr, strVal); matched {
							return false, fmt.Sprintf("parameter '%s' value contains prohibited pattern matching regex '%s' for tool '%s'", paramName, patternStr, toolName)
						}
					}
				}
			}
		}
	}

	// 7. Generic Regex Allow Rules (e.g. Email domain matching, UUID format validation): { "param_name": "^[a-zA-Z0-9._%+-]+@company\\.com$" }
	if regexAllowVal, ok := toolConstraints["regex_allow"]; ok {
		if regexMap, ok := regexAllowVal.(map[string]any); ok {
			for paramName, patternVal := range regexMap {
				if patternStr, ok := patternVal.(string); ok && patternStr != "" {
					if argVal, exists := args[paramName]; exists {
						strVal := fmt.Sprintf("%v", argVal)
						if matched, _ := regexp.MatchString(patternStr, strVal); !matched {
							return false, fmt.Sprintf("parameter '%s' value '%s' does not satisfy required regex pattern '%s' for tool '%s'", paramName, strVal, patternStr, toolName)
						}
					}
				}
			}
		}
	}

	// 8. Generic String Length Limits: { "param_name": { "max_length": 500 } }
	if strLenVal, ok := toolConstraints["string_length"]; ok {
		if lenMap, ok := strLenVal.(map[string]any); ok {
			for paramName, specVal := range lenMap {
				if spec, ok := specVal.(map[string]any); ok {
					if argVal, exists := args[paramName]; exists {
						strVal := fmt.Sprintf("%v", argVal)
						length := len(strVal)
						if maxLen, ok := spec["max_length"].(float64); ok && length > int(maxLen) {
							return false, fmt.Sprintf("parameter '%s' length (%d chars) exceeds maximum allowed length of %d for tool '%s'", paramName, length, int(maxLen), toolName)
						}
					}
				}
			}
		}
	}

	// 9. Rate Limit Check (Redis INCR with TTL)
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
				cnt, err := c.rdb.Incr(ctx, key).Result()
				if err == nil {
					if cnt == 1 {
						c.rdb.Expire(ctx, key, time.Duration(winSec)*time.Second)
					}
					if cnt > maxCalls {
						return false, fmt.Sprintf("rate limit exceeded for tool '%s' (%d / %d calls allowed per %ds window)", toolName, cnt, maxCalls, winSec)
					}
				}
			}
		}
	}

	// 10. Time Window Check (HH:MM format)
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
	}
	return 0.0
}

func parseMinutes(hhmm string) int {
	var h, m int
	if _, err := fmt.Sscanf(hhmm, "%d:%d", &h, &m); err == nil {
		return h*60 + m
	}
	return -1
}
