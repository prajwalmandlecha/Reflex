package proxy

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/agp/gateway/internal/audit"
	"github.com/agp/gateway/internal/authz"
	"github.com/agp/gateway/internal/configcache"
	"github.com/agp/gateway/internal/constraints"
	"github.com/agp/gateway/internal/metrics"
	"github.com/agp/gateway/internal/spend"
)

// governCall runs the full governance pipeline — killswitch → constraints →
// OPA policy → atomic spend/rate-limit commit — and returns whether the call
// is allowed plus all the data needed for telemetry.
func (p *MCPProxy) governCall(
	ctx context.Context,
	kind callKind,
	agentID, classID, agentKind, toolName string,
	amount float64,
	amountFound bool,
	allowedTools []string,
	cfg *configcache.AgentConfig,
	args map[string]any,
) (bool, string, string, GovernanceTimings, []spend.Entry) {
	var t GovernanceTimings

	// Stage 1: Killswitch
	ksStart := time.Now()
	ksRes, err := p.ks.Check(ctx, agentID, classID)
	t.KillswitchMs = ms(time.Since(ksStart))
	metrics.KillswitchDuration.Observe(t.KillswitchMs / 1000.0)

	if err != nil {
		t.GovernanceTotal = t.KillswitchMs
		return false, "killswitch", "internal error: killswitch check failed", t, nil
	}
	if ksRes.Killed {
		t.GovernanceTotal = t.KillswitchMs
		return false, "killswitch", ksRes.Reason, t, nil
	}

	// Stage 2: Static Per-Tool Constraints (stateless checks: time windows).
	// Stateful counters (rate limit, cumulative spend) are committed atomically
	// in Stage 4 — no dry-run/commit split, so there's no TOCTOU window.
	cStart := time.Now()

	// Stage 2a: Per-parameter per-call ceilings (stateless). Each declared param
	// with a Max is checked against the call's value (absolute). This is the
	// parameter-level cap: bounds the actual knob the agent turns, sign-agnostic
	// (handles deposit vs withdraw identically), and scoped per tool+param.
	if kind == callKindTool {
		if ok, reason := p.constraintCheck.CheckParamMax(cfg, toolName, args); !ok {
			t.ConstraintMs = ms(time.Since(cStart))
			metrics.ConstraintCheckDuration.WithLabelValues(toolName).Observe(t.ConstraintMs / 1000.0)
			t.GovernanceTotal = t.KillswitchMs + t.ConstraintMs
			return false, "constraint", reason, t, nil
		}
	}

	cOk, cReason := p.constraintCheck.CheckStatic(cfg, toolName)
	t.ConstraintMs = ms(time.Since(cStart))
	metrics.ConstraintCheckDuration.WithLabelValues(toolName).Observe(t.ConstraintMs / 1000.0)

	if !cOk {
		t.GovernanceTotal = t.KillswitchMs + t.ConstraintMs
		return false, "constraint", cReason, t, nil
	}

	// Stage 3: OPA Policy Engine
	opaStart := time.Now()
	decision, err := p.policyEngine.Evaluate(ctx, &authz.Input{
		AgentID:      agentID,
		AgentKind:    agentKind,
		Action:       toolName,
		Resource:     string(kind), // "tool" | "resource" | "prompt" — lets policies distinguish action types
		Amount:       amount,
		AllowedTools: allowedTools,
		Params:       args,
	})
	t.PolicyMs = ms(time.Since(opaStart))
	metrics.PolicyEvalDuration.WithLabelValues("default").Observe(t.PolicyMs / 1000.0)

	if err != nil {
		t.GovernanceTotal = t.KillswitchMs + t.ConstraintMs + t.PolicyMs
		return false, "policy", "internal error: policy evaluation failed", t, nil
	}
	if !decision.Allow {
		t.GovernanceTotal = t.KillswitchMs + t.ConstraintMs + t.PolicyMs
		return false, "policy", decision.Reason, t, nil
	}

	// Stage 4 (final): Atomic commit of ALL stateful counters — per-tool rate
	// limit, cumulative daily spend, and hierarchical spend caps — in a single
	// Redis Lua script. All-or-nothing: if any cap would be breached, every
	// increment is rolled back inside the script, so denied calls never consume
	// budget (G4) and concurrent calls cannot race between a read and a write.
	spendStart := time.Now()
	entries := p.constraintCheck.CounterEntries(cfg, toolName, args)
	entries = append(entries, p.constraintCheck.ParamCounterEntries(cfg, toolName, args)...)
	spendDelta := int64(amount * 100)
	if spendDelta > 0 {
		entries = append(entries, p.buildDynamicScopes(agentID, classID, cfg.EffectiveCaps, float64(spendDelta))...)
	}

	commitRes, err := p.spendLimiter.Commit(ctx, entries)
	t.SpendCheckMs = ms(time.Since(spendStart))
	metrics.SpendCheckDuration.Observe(t.SpendCheckMs / 1000.0)

	if err != nil {
		t.GovernanceTotal = t.KillswitchMs + t.ConstraintMs + t.PolicyMs + t.SpendCheckMs
		return false, "spend", "internal error: governance counter commit failed", t, nil
	}
	if !commitRes.Allowed {
		stage := "spend"
		if strings.HasPrefix(commitRes.Exceeded, "ratelimit:") || strings.HasPrefix(commitRes.Exceeded, "spendcap:") || strings.HasPrefix(commitRes.Exceeded, "paramcap:") {
			stage = "constraint"
		}
		reason := commitRes.Label
		if reason == "" {
			reason = fmt.Sprintf("spend cap exceeded on scope %s", commitRes.Exceeded)
		}
		reason = fmt.Sprintf("%s (current: %.0f / cap: %.0f)", reason, commitRes.Current, commitRes.Cap)
		t.GovernanceTotal = t.KillswitchMs + t.ConstraintMs + t.PolicyMs + t.SpendCheckMs
		return false, stage, reason, t, nil
	}

	t.GovernanceTotal = t.KillswitchMs + t.ConstraintMs + t.PolicyMs + t.SpendCheckMs
	return true, "", decision.Reason, t, entries
}

// rollbackCommittedEntries refunds the governance counters committed in Stage 4
// when the downstream call fails after governance allowed it — a failed bank
// call must never consume spend or rate-limit budget.
func (p *MCPProxy) rollbackCommittedEntries(entries []spend.Entry, agentID, toolName string) {
	if len(entries) == 0 {
		return
	}
	// Detach from the request context: the client may have hung up, but the
	// refund must still land.
	rbCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := p.spendLimiter.Rollback(rbCtx, entries); err != nil {
		p.logger.Error("failed to roll back governance counters after downstream failure",
			"agent_id", agentID, "tool", toolName, "error", err)
	} else {
		p.logger.Info("rolled back governance counters after downstream failure",
			"agent_id", agentID, "tool", toolName, "entries", len(entries))
	}
}

// buildDynamicScopes expresses the hierarchical spend caps (instance hourly,
// class daily, fleet daily) as counter entries for the atomic commit.
func (p *MCPProxy) buildDynamicScopes(agentID, classID string, caps map[string]map[string]any, amountCents float64) []spend.Entry {
	entries := []spend.Entry{}
	now := time.Now().UTC()

	// Default fallback caps if not set in config
	hourlyCap := float64(500000)
	dailyCap := float64(5000000)

	if caps != nil {
		if h, ok := caps["hourly"]; ok {
			if amt, ok := h["amount_cents"].(float64); ok && amt > 0 {
				hourlyCap = amt
			}
		}
		if d, ok := caps["daily"]; ok {
			if amt, ok := d["amount_cents"].(float64); ok && amt > 0 {
				dailyCap = amt
			}
		}
	}

	// Instance-level hourly scope
	entries = append(entries, spend.Entry{
		Key:        fmt.Sprintf("spend:agent:%s:%s", agentID, now.Format("2006010215")),
		Amount:     amountCents,
		Cap:        hourlyCap,
		TTLSeconds: 172800,
		Label:      fmt.Sprintf("hourly spend cap exceeded for agent '%s' ($%.2f hourly cap)", agentID, hourlyCap/100.0),
	})

	// Class-level daily scope
	if classID != "" {
		entries = append(entries, spend.Entry{
			Key:        fmt.Sprintf("spend:class:%s:%s", classID, now.Format("20060102")),
			Amount:     amountCents,
			Cap:        dailyCap,
			TTLSeconds: 172800,
			Label:      fmt.Sprintf("daily spend cap exceeded for agent class '%s' ($%.2f daily cap)", classID, dailyCap/100.0),
		})
	}

	// Fleet-level daily scope
	entries = append(entries, spend.Entry{
		Key:        fmt.Sprintf("spend:fleet:all:%s", now.Format("20060102")),
		Amount:     amountCents,
		Cap:        50000000,
		TTLSeconds: 172800,
		Label:      "fleet-wide daily spend cap exceeded ($500000.00 daily cap)",
	})

	return entries
}

// extractAmount resolves a call's monetary value in major currency units from
// the legacy amount/amount_cents heuristic. found reports whether a parseable
// amount was present. All money extraction routes through
// constraints.ExtractAmountCents so the proxy (OPA input, metrics,
// hierarchical caps) and the per-param spend-cap counters can never disagree
// on the amount.
func (p *MCPProxy) extractAmount(cfg *configcache.AgentConfig, toolName string, args map[string]any) (float64, bool) {
	cents, found := constraints.ExtractAmountCents(args)
	return cents / 100.0, found
}

// outcomeParams bundles all the data needed to record telemetry (metrics, audit
// log, and event publishing) after a governance decision. Used by recordOutcome
// to eliminate the duplicated ~50-line telemetry block across all request paths.
type outcomeParams struct {
	agentID      string
	classID      string
	actionName   string
	serviceName  string
	allowed      bool
	denyStage    string
	reason       string
	spendDelta   int64 // in cents
	timings      GovernanceTimings
	downstreamMs float64
	totalMs      float64
	params       map[string]any // will be redacted before audit
}

// recordOutcome records Prometheus metrics, publishes a governance event to
// Redis pub/sub, and writes a permanent audit log entry. Centralises the
// telemetry that was previously copy-pasted across the tools/call, resource/
// prompt, and OpenAPI request paths.
func (p *MCPProxy) recordOutcome(ctx context.Context, o *outcomeParams) {
	decisionStr := "deny"
	if o.allowed {
		decisionStr = "allow"
	}
	govOverheadMs := o.timings.GovernanceTotal

	// Prometheus metrics
	metrics.RequestDuration.WithLabelValues(o.actionName, o.classID, decisionStr).Observe(o.totalMs / 1000.0)
	metrics.GovernanceOverhead.WithLabelValues(o.actionName, decisionStr).Observe(govOverheadMs / 1000.0)
	if o.allowed {
		metrics.DownstreamDuration.WithLabelValues(o.serviceName, o.actionName).Observe(o.downstreamMs / 1000.0)
		if o.spendDelta > 0 {
			metrics.SpendProcessed.WithLabelValues(o.agentID, o.classID).Add(float64(o.spendDelta))
		}
	}
	metrics.DecisionsTotal.WithLabelValues(o.actionName, o.classID, decisionStr, o.denyStage).Inc()

	// Redis pub/sub event for frontend WebSocket streaming
	p.publishEvent(ctx, GovernanceEvent{
		Type:            "decision",
		AgentID:         o.agentID,
		AgentClassID:    o.classID,
		Tool:            o.actionName,
		Decision:        decisionStr,
		DenyStage:       o.denyStage,
		Reason:          o.reason,
		SpendDeltaCents: o.spendDelta,
		Latency: map[string]float64{
			"total_ms":               o.totalMs,
			"killswitch_ms":          o.timings.KillswitchMs,
			"constraint_ms":          o.timings.ConstraintMs,
			"policy_ms":              o.timings.PolicyMs,
			"spend_ms":               o.timings.SpendCheckMs,
			"downstream_ms":          o.downstreamMs,
			"governance_overhead_ms": govOverheadMs,
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
	})

	// Permanent hash-chained audit log
	p.auditor.Log(&audit.Entry{
		AgentID:              o.agentID,
		AgentClassID:         o.classID,
		Action:               o.actionName,
		BankConnectionID:     o.serviceName,
		Params:               redactParams(o.params),
		Decision:             decisionStr,
		DenyStage:            o.denyStage,
		Reason:               o.reason,
		SpendDelta:           o.spendDelta,
		TotalLatencyMs:       o.totalMs,
		KillswitchLatencyMs:  o.timings.KillswitchMs,
		PolicyLatencyMs:      o.timings.PolicyMs,
		SpendCheckLatencyMs:  o.timings.SpendCheckMs,
		ConstraintLatencyMs:  o.timings.ConstraintMs,
		DownstreamLatencyMs:  o.downstreamMs,
		GovernanceOverheadMs: govOverheadMs,
	})
}
