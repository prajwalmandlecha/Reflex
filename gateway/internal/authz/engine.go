// Package authz provides embedded OPA/Rego policy evaluation with atomic hot-reload.
package authz

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

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
	AgentID       string         `json:"agent_id"`
	AgentKind     string         `json:"agent_kind"`
	Action        string         `json:"action"`
	Resource      string         `json:"resource"`
	PolicyVersion int            `json:"policy_version"`
	Amount        float64        `json:"amount,omitempty"`
	Currency      string         `json:"currency,omitempty"`
	AllowedTools  []string       `json:"allowed_tools,omitempty"`
	Params        map[string]any `json:"params,omitempty"`
}

// Engine is the embedded OPA policy engine.
type Engine struct {
	prepared       atomic.Pointer[rego.PreparedEvalQuery]
	currentVersion atomic.Int32
	rdb            *redis.Client
	db             *pgxpool.Pool
	logger         *slog.Logger
}

// NewEngine creates a new OPA engine. It loads the initial policy from Postgres/Redis,
// compiles it, and starts the hot-reload listeners.
func NewEngine(ctx context.Context, rdb *redis.Client, db *pgxpool.Pool, logger *slog.Logger, pollInterval time.Duration) (*Engine, error) {
	e := &Engine{
		rdb:    rdb,
		db:     db,
		logger: logger,
	}

	// Load and compile initial policy
	if err := e.loadAndCompile(ctx, true); err != nil {
		logger.Warn("initial policy load fallback", "error", err)
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

	resultMap, ok := rs[0].Expressions[0].Value.(map[string]any)
	if !ok {
		return &Decision{Allow: false, Reason: "policy returned unexpected type"}, nil
	}

	decision := &Decision{}
	if deny, ok := resultMap["deny"].(bool); ok && deny {
		decision.Allow = false
	} else if allow, ok := resultMap["allow"].(bool); ok {
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

// loadAndCompile fetches active policies from Postgres/Redis and compiles them.
func (e *Engine) loadAndCompile(ctx context.Context, force bool) error {
	var regoSource string
	var version int32 = 1

	// Try reading active policies from Redis first
	redisVal, err := e.rdb.Get(ctx, "agp:policy:active").Result()
	if err == nil && redisVal != "" {
		regoSource = redisVal
	} else {
		// Read from Postgres
		rows, err := e.db.Query(ctx, "SELECT rego_source, version FROM policies WHERE status = 'active' ORDER BY id ASC")
		if err == nil {
			defer rows.Close()
			var sources []string
			for rows.Next() {
				var src string
				var ver int
				if err := rows.Scan(&src, &ver); err == nil && src != "" {
					sources = append(sources, src)
					if int32(ver) > version {
						version = int32(ver)
					}
				}
			}
			if len(sources) > 0 {
				regoSource = strings.Join(sources, "\n\n")
			}
		}
	}

	var modules []func(*rego.Rego)
	if regoSource != "" {
		modules = append(modules, rego.Module("active_policy.rego", regoSource))
	} else {
		e.logger.Warn("no active policies found in DB or Redis, using default-deny rule")
		modules = append(modules, rego.Module("default.rego", `
package agp.authz

import rego.v1

default allow := false

# Allow tool if listed in allowed_tools
allow if {
	count(input.allowed_tools) > 0
	input.action in input.allowed_tools
}

# Allow conversational agent default read tools
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind in {"conversational", "onboarding"}
	input.action in {"account.balance", "login", "create_user", "list_contacts", "resolve_contact", "get_balance", "get_transaction_history"}
}

# Allow payments agent
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind in {"payments", "trading", "custom_alpha"}
	input.action in {"login", "create_user", "get_balance", "transfer_money", "deposit_funds"}
}

# Allow DB bot
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind == "database_analytics"
	input.action in {"db_query", "db_export"}
}

# Allow User Admin bot
allow if {
	count(input.allowed_tools) == 0
	input.agent_kind == "user_admin"
	input.action in {"create_user", "update_user_role"}
}

reason := sprintf("action '%s' allowed by agent profile", [input.action]) if allow
reason := sprintf("action '%s' is not permitted by policy for agent kind '%s'", [input.action, input.agent_kind]) if not allow
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
	e.currentVersion.Store(version)
	e.logger.Info("policy compiled and loaded into OPA engine", "version", version)
	return nil
}

// subscribePolicyUpdates listens on Redis "config:updates" and "policy:updates" channels.
func (e *Engine) subscribePolicyUpdates(ctx context.Context) {
	sub := e.rdb.Subscribe(ctx, "config:updates", "policy:updates")
	defer sub.Close()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			e.logger.Info("received policy reload notification", "channel", msg.Channel)
			_ = e.loadAndCompile(ctx, true)
		}
	}
}

func (e *Engine) pollPolicies(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = e.loadAndCompile(ctx, false)
		}
	}
}

func structToMap(v any) (map[string]any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var res map[string]any
	err = json.Unmarshal(b, &res)
	return res, err
}
