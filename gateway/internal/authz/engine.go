// Package authz provides embedded OPA/Rego policy evaluation with atomic hot-reload.
//
// Policies are compiled once and stored behind an atomic.Pointer for lock-free reads
// on the hot path. Updates arrive via Redis pub/sub and are compiled + swapped atomically;
// a compile failure falls back to the currently-serving policy. A 30-second Postgres poll
// acts as a safety net in case a replica misses the pub/sub message.
package authz

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/agp/gateway/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/open-policy-agent/opa/v1/rego"
	"github.com/redis/go-redis/v9"
)

// Decision is the result of a policy evaluation.
type Decision struct {
	Allow  bool   `json:"allow"`
	Reason string `json:"reason,omitempty"`
}

// Input is the data supplied to OPA for each authorization request.
type Input struct {
	AgentID       string   `json:"agent_id"`
	AgentKind     string   `json:"agent_kind"`
	Action        string   `json:"action"`
	Resource      string   `json:"resource"`
	PolicyVersion int      `json:"policy_version"`
	Amount        float64  `json:"amount,omitempty"`
	Currency      string   `json:"currency,omitempty"`
	AllowedTools  []string `json:"allowed_tools,omitempty"`
}

// Engine is the embedded OPA policy engine.
type Engine struct {
	prepared atomic.Pointer[rego.PreparedEvalQuery]
	rdb      *redis.Client
	db       *pgxpool.Pool
	logger   *slog.Logger
}

// NewEngine creates a new OPA engine. It loads the initial policy from Postgres,
// compiles it, and starts the hot-reload listeners.
func NewEngine(ctx context.Context, rdb *redis.Client, db *pgxpool.Pool, logger *slog.Logger, pollInterval time.Duration) (*Engine, error) {
	e := &Engine{
		rdb:    rdb,
		db:     db,
		logger: logger,
	}

	// Load and compile initial policy
	if err := e.loadAndCompile(ctx); err != nil {
		return nil, fmt.Errorf("initial policy load: %w", err)
	}

	// Start Redis pub/sub listener for policy hot-reload
	go e.subscribePolicyUpdates(ctx)

	// Start Postgres poll fallback
	go e.pollPolicies(ctx, pollInterval)

	return e, nil
}

// Evaluate runs the policy against the given input and returns the decision.
func (e *Engine) Evaluate(ctx context.Context, input *Input) (*Decision, error) {
	pq := e.prepared.Load()
	if pq == nil {
		return &Decision{Allow: false, Reason: "no policy loaded"}, nil
	}

	inputMap, err := structToMap(input)
	if err != nil {
		return nil, fmt.Errorf("marshaling input: %w", err)
	}

	rs, err := pq.Eval(ctx, rego.EvalInput(inputMap))
	if err != nil {
		return nil, fmt.Errorf("evaluating policy: %w", err)
	}

	if len(rs) == 0 || len(rs[0].Expressions) == 0 {
		return &Decision{Allow: false, Reason: "policy returned no result (default deny)"}, nil
	}

	// The query is "data.agp.authz" which returns an object with "allow" and "reason" fields
	resultMap, ok := rs[0].Expressions[0].Value.(map[string]any)
	if !ok {
		return &Decision{Allow: false, Reason: "policy returned unexpected type"}, nil
	}

	decision := &Decision{}
	if allow, ok := resultMap["allow"].(bool); ok {
		decision.Allow = allow
	}
	if reason, ok := resultMap["reason"].(string); ok {
		decision.Reason = reason
	}
	if !decision.Allow && decision.Reason == "" {
		decision.Reason = "denied by policy"
	}

	return decision, nil
}

// loadAndCompile fetches active policies from Postgres via sqlc and compiles them.
func (e *Engine) loadAndCompile(ctx context.Context) error {
	queries := db.New(e.db)
	policyRow, err := queries.GetPolicyByName(ctx, "default")

	var modules []func(*rego.Rego)
	if err == nil && policyRow.Source != "" {
		modules = append(modules, rego.Module("policy_default.rego", policyRow.Source))
	}

	if len(modules) == 0 {
		e.logger.Warn("no active policies found, using empty default-deny")
		modules = append(modules, rego.Module("default.rego", `
package agp.authz
default allow = false
reason = "no policies configured"
`))
	}

	opts := []func(*rego.Rego){
		rego.Query("data.agp.authz"),
	}
	opts = append(opts, modules...)

	r := rego.New(opts...)
	pq, err := r.PrepareForEval(ctx)
	if err != nil {
		return fmt.Errorf("compiling policy: %w", err)
	}

	e.prepared.Store(&pq)
	e.logger.Info("policy compiled and loaded", "module_count", len(modules))
	return nil
}

// subscribePolicyUpdates listens on the Redis "policy:updates" channel and reloads on message.
func (e *Engine) subscribePolicyUpdates(ctx context.Context) {
	sub := e.rdb.Subscribe(ctx, "policy:updates")
	defer sub.Close()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case _, ok := <-ch:
			if !ok {
				return
			}
			e.logger.Info("policy update received via pub/sub, reloading")
			if err := e.loadAndCompile(ctx); err != nil {
				e.logger.Error("failed to reload policy from pub/sub", "error", err)
				// Keep serving the old policy — atomic pointer was not swapped
			}
		}
	}
}

// pollPolicies periodically reloads policies from Postgres as a fallback.
func (e *Engine) pollPolicies(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := e.loadAndCompile(ctx); err != nil {
				e.logger.Error("failed to reload policy from poll", "error", err)
			}
		}
	}
}

func structToMap(v any) (map[string]any, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return m, nil
}
