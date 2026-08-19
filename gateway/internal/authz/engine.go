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
	AgentID       string         `json:"agent_id"`
	AgentKind     string         `json:"agent_kind"`
	Action        string         `json:"action"`
	Resource      string         `json:"resource"`
	PolicyVersion int            `json:"policy_version"`
	AllowedTools  []string       `json:"allowed_tools,omitempty"`
	Params        map[string]any `json:"params,omitempty"`
	// Constraints carries the tool's effective operational constraints (e.g.
	// time_window) so Rego can enforce stateless rules that were historically
	// evaluated in Go. Kept as raw JSON so policies can read any declared cap.
	Constraints map[string]any `json:"constraints,omitempty"`
}

// Engine is the embedded OPA policy engine.
type Engine struct {
	prepared atomic.Pointer[rego.PreparedEvalQuery]
	// fingerprint is the last-seen (count, maxVersion) of the active policy
	// set. It lets the 30s poller skip the expensive re-read/recompile when
	// nothing changed. A zero value means "never loaded" so the first poll
	// always compiles.
	fingerprint atomic.Uint64
	rdb         *redis.Client
	db          *pgxpool.Pool
	logger      *slog.Logger
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
// Each policy is compiled as its OWN module under a unique package path
// (data.agp.policies.p<i>), preserving its original source verbatim — no string
// stripping. A small aggregator module (data.agp.authz) merges the per-policy
// results: any explicit deny wins; otherwise allow if any policy allows;
// otherwise default-deny. This eliminates both the default-allow inversion and
// the ReplaceAll source-mangling bugs.
func (e *Engine) loadAndCompile(ctx context.Context, force bool) error {
	var version int32 = 1

	// Fast path: when not forced (i.e. the periodic poller), skip the expensive
	// re-read/recompile entirely if the active policy set is unchanged. The
	// fingerprint is (count, maxVersion) so deleting a non-max-version policy is
	// still detected. We only skip once we've loaded at least once (prepared !=
	// nil), so the first pass always compiles even when the set is empty.
	if !force && e.prepared.Load() != nil {
		if fp, ok := e.activePolicyFingerprint(ctx); ok && fp == e.fingerprint.Load() {
			return nil
		}
	}

	// Read from Postgres or Redis
	var rawSources []string
	redisVal, err := e.rdb.Get(ctx, "agp:policy:active").Result()
	if err == nil && redisVal != "" {
		// Redis stores the concatenation of full policy sources; split them back
		// into individual modules on their package declarations.
		rawSources = append(rawSources, splitPolicySources(redisVal)...)
	} else {
		q := db.New(e.db)
		rows, err := q.ListActivePolicies(ctx)
		if err == nil {
			for _, row := range rows {
				src := row.RegoSource.String
				if src != "" {
					rawSources = append(rawSources, splitPolicySources(src)...)
					if row.Version > version {
						version = row.Version
					}
				}
			}
		}
	}

	var modules []func(*rego.Rego)
	if len(rawSources) > 0 {
		for i, src := range rawSources {
			// Rewrite ONLY the leading package declaration to a unique path so
			// multiple policies can coexist in one OPA store. Rule bodies are
			// untouched.
			rewritten := rewritePackage(src, fmt.Sprintf("agp.policies.p%d", i))
			modules = append(modules, rego.Module(fmt.Sprintf("policy_%d.rego", i), rewritten))
		}
		// Aggregator: merge per-policy decisions.
		modules = append(modules, rego.Module("aggregator.rego", aggregatorModule(len(rawSources))))
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

# Execution Time Window (business hours) — enforced in Rego. The tool's
# effective constraints are passed in as input.constraints. If a tool declares
# a time_window {start, end} in HH:MM UTC, calls outside that window are denied.
# Handles overnight windows (start > end) by wrapping past midnight.
deny if {
	tw := input.constraints.time_window
	tw.start != ""
	tw.end != ""
	not within_window(tw.start, tw.end)
}

reason := sprintf("action '%s' is restricted outside business hours (%s to %s UTC)", [input.action, input.constraints.time_window.start, input.constraints.time_window.end]) if {
	tw := input.constraints.time_window
	tw.start != ""
	tw.end != ""
	not within_window(tw.start, tw.end)
}

within_window(start, end) if {
	start <= end
	now_minutes >= start_minutes(start)
	now_minutes <= start_minutes(end)
}

within_window(start, end) if {
	start > end
	now_minutes >= start_minutes(start)
}

within_window(start, end) if {
	start > end
	now_minutes <= start_minutes(end)
}

now_minutes := (clock[0] * 60) + clock[1] if {
	clock := time.clock(time.now_ns())
}

start_minutes(hhmm) := (h * 60) + m if {
	parts := split(hhmm, ":")
	h := to_number(parts[0])
	m := to_number(parts[1])
}
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
	// Record the fingerprint of what we just compiled so the next poll can skip
	// if nothing changed. Only update on success so a transient failure doesn't
	// poison the fast path.
	if fp, ok := e.activePolicyFingerprint(ctx); ok {
		e.fingerprint.Store(fp)
	}
	e.logger.Info("policy compiled and loaded into OPA engine", "version", version)
	return nil
}

// activePolicyFingerprint returns a cheap (count, maxVersion) fingerprint of the
// active policy set, or ok=false if the query failed. It is used to decide
// whether a poll needs to recompile. Postgres is the source of truth for
// policies; Redis is only a cache of it, so we fingerprint Postgres directly.
func (e *Engine) activePolicyFingerprint(ctx context.Context) (uint64, bool) {
	q := db.New(e.db)
	row, err := q.GetActivePolicyFingerprint(ctx)
	if err != nil {
		e.logger.Warn("failed to read active policy fingerprint", "error", err)
		return 0, false
	}
	// Pack (count, maxVersion) into a single uint64. Both are non-negative.
	return (uint64(row.PolicyCount) << 32) | uint64(row.MaxVersion), true
}

// splitPolicySources splits a blob that may contain several concatenated Rego
// policies (each beginning with a `package` declaration) into individual module
// sources. A single-policy input is returned unchanged (as a one-element slice).
func splitPolicySources(blob string) []string {
	// Split on lines that start a new package declaration.
	lines := strings.Split(blob, "\n")
	var modules []string
	var cur []string
	for _, ln := range lines {
		if strings.HasPrefix(strings.TrimSpace(ln), "package ") && len(cur) > 0 {
			modules = append(modules, strings.TrimSpace(strings.Join(cur, "\n")))
			cur = cur[:0]
		}
		cur = append(cur, ln)
	}
	if len(cur) > 0 {
		if s := strings.TrimSpace(strings.Join(cur, "\n")); s != "" {
			modules = append(modules, s)
		}
	}
	// Filter out empties.
	out := modules[:0]
	for _, m := range modules {
		if m != "" {
			out = append(out, m)
		}
	}
	return out
}

// rewritePackage replaces ONLY the first `package <path>` line with
// `package <newPath>`, leaving the rest of the source byte-for-byte intact.
func rewritePackage(src, newPath string) string {
	lines := strings.Split(src, "\n")
	for i, ln := range lines {
		t := strings.TrimSpace(ln)
		if strings.HasPrefix(t, "package ") {
			lines[i] = "package " + newPath
			return strings.Join(lines, "\n")
		}
		// Skip blank lines and comments before the package clause.
		if t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		// First non-comment, non-blank line is not a package clause; bail.
		break
	}
	// No package clause found — prepend one so the module is valid.
	return "package " + newPath + "\n\n" + src
}

// aggregatorModule builds the data.agp.authz module that merges N per-policy
// modules. Decision semantics:
//   - deny  := true if ANY policy's deny is true
//   - allow := true if ANY policy's allow is true AND no policy denied
//   - default allow := false (default-deny when nothing matches)
func aggregatorModule(n int) string {
	var b strings.Builder
	b.WriteString("package agp.authz\n\nimport rego.v1\n\n")
	b.WriteString("default allow := false\ndefault deny := false\n\n")

	// deny if any policy denies.
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "deny if {\n\tdata.agp.policies.p%d.deny\n}\n\n", i)
	}

	// allow if any policy allows and none deny.
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "allow if {\n\tdata.agp.policies.p%d.allow\n\tnot deny\n}\n\n", i)
	}

	// Reason: reflect the merged decision. Sub-policy `reason` rules are partial
	// and vary widely, so rather than fragile else-chains we surface a clear,
	// decision-accurate reason. (Per-policy reasons remain available under
	// data.agp.policies.p<i>.reason for debugging.)
	b.WriteString("reason := \"denied by policy\" if {\n\tdeny\n}\n\n")
	b.WriteString("reason := \"allowed by policy\" if {\n\tallow\n\tnot deny\n}\n\n")
	b.WriteString("reason := \"denied by policy (no rule matched)\" if {\n\tnot allow\n\tnot deny\n}\n")

	return b.String()
}

// subscribePolicyUpdates listens on Redis "config:updates" for policy reload
// notifications. (The backend publishes only "config:updates"; the old
// "policy:updates" channel was never published to and has been removed.)
func (e *Engine) subscribePolicyUpdates(ctx context.Context) {
	sub := e.rdb.Subscribe(ctx, "config:updates")
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
			// Only recompile when the change actually affects policies. A
			// bank-connection edit, agent-instance change, or fleet toggle
			// publishes on the same channel but must not trigger a full Rego
			// recompile. The 30s poll is the safety net for any missed message.
			var update struct {
				Type string `json:"type"`
			}
			if json.Unmarshal([]byte(msg.Payload), &update) != nil || update.Type != "policy" {
				continue
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
