// Package gateway wires the authorization pipeline and MCP server/client.
//
// The handler implements the hot path:
//  1. Kill switch (Redis)
//  2. OPA policy (in-process)
//  3. Spend cap (Redis Lua)
//  4. Audit log (async, off hot path)
package gateway

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/agp/gateway/internal/audit"
	"github.com/agp/gateway/internal/authz"
	"github.com/agp/gateway/internal/killswitch"
	"github.com/agp/gateway/internal/metrics"
	"github.com/agp/gateway/internal/spend"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// AuthorizeRequest is the inbound request from an agent.
type AuthorizeRequest struct {
	AgentID   string  `json:"agent_id"`
	AgentKind string  `json:"agent_kind"`
	Action    string  `json:"action"`
	Resource  string  `json:"resource"`
	Amount    float64 `json:"amount,omitempty"`
	Currency  string  `json:"currency,omitempty"`
}

// AuthorizeResponse is the gateway's decision.
type AuthorizeResponse struct {
	Allow   bool   `json:"allow"`
	Reason  string `json:"reason"`
	TraceID string `json:"trace_id,omitempty"`
}

// Handler is the core authorization pipeline.
type Handler struct {
	killSwitch *killswitch.Switch
	policy     *authz.Engine
	spender    *spend.Limiter
	auditor    *audit.Logger
	db         *pgxpool.Pool
	logger     *slog.Logger
}

// NewHandler creates a new authorization pipeline handler.
func NewHandler(
	ks *killswitch.Switch,
	policy *authz.Engine,
	spender *spend.Limiter,
	auditor *audit.Logger,
	db *pgxpool.Pool,
	logger *slog.Logger,
) *Handler {
	return &Handler{
		killSwitch: ks,
		policy:     policy,
		spender:    spender,
		auditor:    auditor,
		db:         db,
		logger:     logger,
	}
}

// Authorize runs the full authorization pipeline for a single agent request.
func (h *Handler) Authorize(ctx context.Context, req *AuthorizeRequest) *AuthorizeResponse {
	start := time.Now()
	defer func() {
		metrics.DecisionLatency.Observe(time.Since(start).Seconds())
	}()

	// --- Step 1: Kill switch (checked first, highest priority) ---
	ksResult, err := h.killSwitch.Check(ctx, req.AgentID)
	if err != nil {
		h.logger.Error("kill switch check failed", "error", err, "agent_id", req.AgentID)
		return h.deny(req, start, 0, "internal error: kill switch check failed")
	}
	if ksResult.Killed {
		scope := "agent"
		if ksResult.Reason == "fleet-wide emergency stop active" {
			scope = "fleet"
		}
		metrics.KillSwitchActivations.With(prometheus.Labels{"scope": scope}).Inc()
		metrics.DecisionsTotal.With(prometheus.Labels{"decision": "deny", "reason_category": "killswitch"}).Inc()
		return h.deny(req, start, 0, ksResult.Reason)
	}

	// --- Step 2: OPA policy ---
	decision, err := h.policy.Evaluate(ctx, &authz.Input{
		AgentID:   req.AgentID,
		AgentKind: req.AgentKind,
		Action:    req.Action,
		Resource:  req.Resource,
		Amount:    req.Amount,
		Currency:  req.Currency,
	})
	if err != nil {
		h.logger.Error("policy evaluation failed", "error", err, "agent_id", req.AgentID)
		return h.deny(req, start, 0, "internal error: policy evaluation failed")
	}
	if !decision.Allow {
		metrics.DecisionsTotal.With(prometheus.Labels{"decision": "deny", "reason_category": "policy"}).Inc()
		return h.deny(req, start, 0, decision.Reason)
	}

	// --- Step 3: Spend cap (only for requests with a monetary amount) ---
	spendDelta := int64(req.Amount * 100) // Convert to cents
	if spendDelta > 0 {
		scopes, err := h.loadSpendScopes(ctx, req.AgentID, req.Action)
		if err != nil {
			h.logger.Error("loading spend scopes failed", "error", err, "agent_id", req.AgentID)
			return h.deny(req, start, 0, "internal error: spend scope lookup failed")
		}

		if len(scopes) > 0 {
			spendResult, err := h.spender.Check(ctx, spendDelta, scopes)
			if err != nil {
				h.logger.Error("spend check failed", "error", err, "agent_id", req.AgentID)
				return h.deny(req, start, 0, "internal error: spend check failed")
			}
			if !spendResult.Allowed {
				metrics.DecisionsTotal.With(prometheus.Labels{"decision": "deny", "reason_category": "spend_cap"}).Inc()
				return h.deny(req, start, spendDelta,
					fmt.Sprintf("spend cap exceeded on scope %s (current: %d)", spendResult.ExceededKey, spendResult.Current))
			}
		}

		metrics.SpendTotal.With(prometheus.Labels{
			"agent_id": req.AgentID,
			"category": req.Action,
		}).Add(float64(spendDelta))
	}

	// --- Step 4: Allowed ---
	metrics.DecisionsTotal.With(prometheus.Labels{"decision": "allow", "reason_category": "policy"}).Inc()

	resp := &AuthorizeResponse{Allow: true, Reason: decision.Reason}
	h.emitAudit(req, resp, start, spendDelta)
	return resp
}

// deny is a helper that builds a deny response and emits the audit entry.
func (h *Handler) deny(req *AuthorizeRequest, start time.Time, spendDelta int64, reason string) *AuthorizeResponse {
	resp := &AuthorizeResponse{Allow: false, Reason: reason}
	h.emitAudit(req, resp, start, spendDelta)
	return resp
}

// loadSpendScopes queries budget_caps from Postgres and builds Redis scope keys.
func (h *Handler) loadSpendScopes(ctx context.Context, agentID, action string) ([]spend.Scope, error) {
	rows, err := h.db.Query(ctx,
		`SELECT scope_type, scope_id, period, limit_amount FROM budget_caps
		 WHERE (scope_type = 'agent' AND scope_id = $1)
		    OR (scope_type = 'category' AND scope_id = $2)
		    OR scope_type IN ('fleet', 'global')`,
		agentID, action)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var scopes []spend.Scope
	for rows.Next() {
		var (
			scopeType   string
			scopeID     string
			period      string
			limitAmount int64
		)
		if err := rows.Scan(&scopeType, &scopeID, &period, &limitAmount); err != nil {
			return nil, err
		}

		window := currentWindow(period)
		key := fmt.Sprintf("spend:%s:%s:%s", scopeType, scopeID, window)
		scopes = append(scopes, spend.Scope{Key: key, Cap: limitAmount})
	}

	return scopes, rows.Err()
}

// currentWindow returns a time-window key for the given period.
func currentWindow(period string) string {
	now := time.Now().UTC()
	switch period {
	case "hourly":
		return now.Format("2006010215")
	case "daily":
		return now.Format("20060102")
	case "monthly":
		return now.Format("200601")
	default:
		return now.Format("20060102")
	}
}

func (h *Handler) emitAudit(req *AuthorizeRequest, resp *AuthorizeResponse, start time.Time, spendDelta int64) {
	decision := "deny"
	if resp.Allow {
		decision = "allow"
	}

	h.auditor.Log(&audit.Entry{
		AgentID:    req.AgentID,
		Action:     req.Action,
		Resource:   req.Resource,
		Decision:   decision,
		SpendDelta: spendDelta,
		LatencyMs:  float64(time.Since(start).Microseconds()) / 1000.0,
		Reason:     resp.Reason,
	})
	metrics.AuditEntriesWritten.Inc()
}
