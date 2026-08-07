// Package proxy implements an in-flight MCP Security Interceptor & Proxy with multi-server routing,
// Agent Profile/ABAC tool whitelisting, dynamic constraints/caps, OpenAPI-to-MCP virtualization,
// high-precision per-stage latency metrics, and Redis pub/sub event publishing.
package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/agp/gateway/internal/adapter"
	"github.com/agp/gateway/internal/audit"
	"github.com/agp/gateway/internal/authn"
	"github.com/agp/gateway/internal/authz"
	"github.com/agp/gateway/internal/configcache"
	"github.com/agp/gateway/internal/constraints"
	"github.com/agp/gateway/internal/killswitch"
	"github.com/agp/gateway/internal/metrics"
	"github.com/agp/gateway/internal/spend"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/redis/go-redis/v9"
)

type OpenAPISpecTarget struct {
	BaseURL string
	Doc     *openapi3.T
}

type GovernanceTimings struct {
	KillswitchMs    float64
	ConstraintMs    float64
	PolicyMs        float64
	SpendCheckMs    float64
	GovernanceTotal float64
}

type GovernanceEvent struct {
	Type            string             `json:"type"`
	AgentID         string             `json:"agent_id"`
	AgentClassID    string             `json:"agent_class_id"`
	Tool            string             `json:"tool"`
	Decision        string             `json:"decision"`
	DenyStage       string             `json:"deny_stage"`
	Reason          string             `json:"reason"`
	SpendDeltaCents int64              `json:"spend_delta_cents"`
	Latency         map[string]float64 `json:"latency"`
	Timestamp       string             `json:"timestamp"`
}

type MCPProxy struct {
	targets         map[string]string // effective: env targets + native-MCP connections
	targetsMux      sync.RWMutex
	envTargets      map[string]string // static MCP_TARGETS from env, never reloaded
	openAPITargets  map[string]*OpenAPISpecTarget
	openAPIMux      sync.RWMutex
	connAuth        map[string]*downstreamAuth // connection_id → downstream creds
	connAuthMux     sync.RWMutex
	toolRouting     map[string]string // tool_name → service/connection_id
	toolRoutingMux  sync.RWMutex
	ks              *killswitch.Switch
	policyEngine    *authz.Engine
	spendLimiter    *spend.Limiter
	constraintCheck *constraints.Checker
	configCache     *configcache.ConfigCache
	auditor         *audit.Logger
	jwtMgr          *authn.JWTManager
	rdb             *redis.Client
	logger          *slog.Logger
	client          *http.Client
}

func NewMCPProxy(
	targets map[string]string,
	ks *killswitch.Switch,
	policyEngine *authz.Engine,
	spendLimiter *spend.Limiter,
	constraintCheck *constraints.Checker,
	configCache *configcache.ConfigCache,
	auditor *audit.Logger,
	jwtMgr *authn.JWTManager,
	rdb *redis.Client,
	logger *slog.Logger,
) *MCPProxy {
	return &MCPProxy{
		targets:         targets,
		envTargets:      targets,
		openAPITargets:  make(map[string]*OpenAPISpecTarget),
		connAuth:        make(map[string]*downstreamAuth),
		toolRouting:     make(map[string]string),
		ks:              ks,
		policyEngine:    policyEngine,
		spendLimiter:    spendLimiter,
		constraintCheck: constraintCheck,
		configCache:     configCache,
		auditor:         auditor,
		jwtMgr:          jwtMgr,
		rdb:             rdb,
		logger:          logger,
		client:          &http.Client{Timeout: 15 * time.Second},
	}
}

// connectionEntry mirrors a single bank_connections row as cached in Redis
// under agp:connections by the backend.
type connectionEntry struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	SourceType     string          `json:"source_type"`
	MCPURL         string          `json:"mcp_url"`
	BaseURL        string          `json:"base_url"`
	OpenAPISpec    string          `json:"openapi_spec"`
	DownstreamAuth *downstreamAuth `json:"downstream_auth"`
}

// downstreamAuth carries a connection's decrypted credentials so the gateway
// can authenticate to the downstream bank server. The backend decrypts (it owns
// FERNET_KEY) and hands the ready-to-use secret via Redis.
type downstreamAuth struct {
	Type   string `json:"type"` // bearer | api_key | basic | header
	Secret string `json:"secret"`
}

// LoadOpenAPISpecs reads the bank-connection cache from Redis and registers an
// OpenAPI virtual target for every connection of source_type "openapi" that has
// a spec. It replaces the entire OpenAPI target set atomically. Called once at
// startup and again whenever a connection/openapi config-update arrives (G7).
func (p *MCPProxy) LoadOpenAPISpecs(ctx context.Context) {
	if p.rdb == nil {
		return
	}
	raw, err := p.rdb.Get(ctx, "agp:connections").Result()
	if err != nil || raw == "" {
		return
	}
	var mapping map[string]connectionEntry
	if err := json.Unmarshal([]byte(raw), &mapping); err != nil {
		p.logger.Warn("failed to parse agp:connections for openapi specs", "error", err)
		return
	}

	newTargets := make(map[string]*OpenAPISpecTarget)
	for id, conn := range mapping {
		if conn.SourceType != "openapi" || conn.OpenAPISpec == "" {
			continue
		}
		doc, err := adapter.LoadSpec([]byte(conn.OpenAPISpec))
		if err != nil {
			p.logger.Warn("skipping unparsable openapi spec", "connection", id, "error", err)
			continue
		}
		baseURL := conn.BaseURL
		if baseURL == "" {
			baseURL = "http://localhost:8080"
		}
		newTargets[id] = &OpenAPISpecTarget{BaseURL: baseURL, Doc: doc}
	}

	p.openAPIMux.Lock()
	p.openAPITargets = newTargets
	p.openAPIMux.Unlock()
	p.logger.Info("loaded openapi virtual targets", "count", len(newTargets))
}

// LoadConnectionAuth is the exported entrypoint for initial load at startup.
func (p *MCPProxy) LoadConnectionAuth(ctx context.Context) {
	p.loadConnectionAuth(ctx)
}

// loadConnectionAuth rebuilds the per-connection downstream-auth map from
// agp:connections. Called whenever connections are reloaded so newly-registered
// or rotated credentials take effect without a restart.
func (p *MCPProxy) loadConnectionAuth(ctx context.Context) {
	if p.rdb == nil {
		return
	}
	raw, err := p.rdb.Get(ctx, "agp:connections").Result()
	if err != nil || raw == "" {
		return
	}
	var mapping map[string]connectionEntry
	if err := json.Unmarshal([]byte(raw), &mapping); err != nil {
		p.logger.Warn("failed to parse agp:connections for downstream auth", "error", err)
		return
	}

	newAuth := make(map[string]*downstreamAuth)
	for id, conn := range mapping {
		if conn.DownstreamAuth != nil && conn.DownstreamAuth.Secret != "" {
			newAuth[id] = conn.DownstreamAuth
		}
	}

	p.connAuthMux.Lock()
	p.connAuth = newAuth
	p.connAuthMux.Unlock()
	p.logger.Info("loaded downstream connection auth", "count", len(newAuth))
}

// authForConnection returns the downstream-auth descriptor for a connection, or nil.
func (p *MCPProxy) authForConnection(connectionID string) *downstreamAuth {
	p.connAuthMux.RLock()
	defer p.connAuthMux.RUnlock()
	return p.connAuth[connectionID]
}

// injectDownstreamAuth sets the appropriate auth header on an outbound request
// to a downstream bank server, based on the connection's credential type. The
// agent's own JWT is never forwarded (stripped earlier); this is the bank's
// OWN credential, which is a separate trust boundary.
func injectDownstreamAuth(req *http.Request, auth *downstreamAuth) {
	if auth == nil || auth.Secret == "" {
		return
	}
	switch auth.Type {
	case "bearer":
		req.Header.Set("Authorization", "Bearer "+auth.Secret)
	case "basic":
		req.SetBasicAuth("", auth.Secret) // secret is the password; username unused
	case "api_key":
		req.Header.Set("X-API-Key", auth.Secret)
	case "header":
		// secret is expected as "Header-Name: value"
		if parts := strings.SplitN(auth.Secret, ":", 2); len(parts) == 2 {
			req.Header.Set(strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]))
		}
	default:
		// Unknown type: default to bearer.
		req.Header.Set("Authorization", "Bearer "+auth.Secret)
	}
}

// LoadNativeTargets rebuilds the effective native-MCP target map by merging the
// static env MCP_TARGETS with any native_mcp bank_connections cached in Redis.
// This lets connections registered at runtime become routable without a restart
// (previously only OpenAPI connections were hot-reloaded). Env targets win on
// name conflicts so an operator can always override via config.
func (p *MCPProxy) LoadNativeTargets(ctx context.Context) {
	merged := make(map[string]string, len(p.envTargets))
	for k, v := range p.envTargets {
		merged[k] = v
	}

	if p.rdb != nil {
		raw, err := p.rdb.Get(ctx, "agp:connections").Result()
		if err == nil && raw != "" {
			var mapping map[string]connectionEntry
			if err := json.Unmarshal([]byte(raw), &mapping); err == nil {
				for id, conn := range mapping {
					if conn.SourceType == "native_mcp" && conn.MCPURL != "" {
						if _, overridden := p.envTargets[id]; !overridden {
							merged[id] = conn.MCPURL
						}
					}
				}
			}
		}
	}

	p.targetsMux.Lock()
	p.targets = merged
	p.targetsMux.Unlock()
	p.logger.Info("loaded native mcp targets", "count", len(merged))
}

// getTarget returns the downstream URL for a service name, or the default.
func (p *MCPProxy) getTarget(serviceName string) (string, bool) {
	p.targetsMux.RLock()
	defer p.targetsMux.RUnlock()
	if serviceName != "" {
		if url, ok := p.targets[serviceName]; ok {
			return url, true
		}
	}
	if url, ok := p.targets["default"]; ok {
		return url, true
	}
	return "", false
}

// rangeTargets calls fn for each target (snapshot under read lock).
func (p *MCPProxy) rangeTargets(fn func(svcName, targetBaseURL string)) {
	p.targetsMux.RLock()
	defer p.targetsMux.RUnlock()
	for svcName, targetBaseURL := range p.targets {
		fn(svcName, targetBaseURL)
	}
}

// LoadToolRouting reads the tool_name → connection_id mapping from Redis.
// This enables the gateway to route /mcp requests to the correct downstream
// based on the tool name in tools/call, without requiring a service-specific URL.
func (p *MCPProxy) LoadToolRouting(ctx context.Context) {
	if p.rdb == nil {
		return
	}
	raw, err := p.rdb.Get(ctx, "agp:tool_routing").Result()
	if err != nil || raw == "" {
		return
	}
	var mapping map[string]string
	if err := json.Unmarshal([]byte(raw), &mapping); err != nil {
		p.logger.Warn("failed to parse agp:tool_routing", "error", err)
		return
	}
	p.toolRoutingMux.Lock()
	p.toolRouting = mapping
	p.toolRoutingMux.Unlock()
	p.logger.Info("loaded tool routing map", "count", len(mapping))
}

// resolveServiceForTool returns the connection_id that owns the given tool.
func (p *MCPProxy) resolveServiceForTool(toolName string) string {
	p.toolRoutingMux.RLock()
	defer p.toolRoutingMux.RUnlock()
	return p.toolRouting[toolName]
}

// SubscribeConnectionUpdates listens for connection/openapi config changes and
// reloads OpenAPI virtual targets so newly-registered specs take effect without
// a restart. Runs until ctx is cancelled.
func (p *MCPProxy) SubscribeConnectionUpdates(ctx context.Context) {
	if p.rdb == nil {
		return
	}
	sub := p.rdb.Subscribe(ctx, "config:updates")
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
			// Reload on any connection/openapi change.
			if msg == nil {
				continue
			}
			p.LoadOpenAPISpecs(ctx)
			p.LoadToolRouting(ctx)
			p.LoadNativeTargets(ctx)
			p.loadConnectionAuth(ctx)
		}
	}
}

func (p *MCPProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	reqStart := time.Now()

	// Step 1: Extract Agent Identity
	agentID, agentKind, err := p.extractIdentity(r)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"unauthorized: %v"}`, err), http.StatusUnauthorized)
		return
	}

	// Step 2: Fetch Agent Config from ConfigCache (Redis with Backend fallback)
	agentCfg := p.configCache.Get(r.Context(), agentID)
	classID := agentCfg.ClassID
	allowedTools := agentCfg.EffectiveTools

	if agentCfg.Status == "revoked" {
		p.logger.Warn("request blocked by agent status revocation", "agent_id", agentID)
		p.sendErrorResponse(w, r, nil, "agent is revoked")
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

	var rpcReq map[string]any
	if len(bodyBytes) > 0 {
		_ = json.Unmarshal(bodyBytes, &rpcReq)
	}

	method, _ := rpcReq["method"].(string)
	reqID := rpcReq["id"]

	// JSON-RPC notifications (no "id" field) must receive 202 Accepted per MCP spec.
	// VS Code's MCP client logs "Unexpected 200 response" for notifications that
	// get a 200 instead of 202.
	if reqID == nil && method != "" && strings.HasPrefix(method, "notifications/") {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusAccepted)
		return
	}

	// Resolve the target service via tool routing for tools/call
	var serviceName string
	if method == "tools/call" {
		params, _ := rpcReq["params"].(map[string]any)
		toolName, _ := params["name"].(string)
		if toolName != "" {
			if resolved := p.resolveServiceForTool(toolName); resolved != "" {
				serviceName = resolved
				p.logger.Debug("resolved service via tool routing", "tool", toolName, "service", serviceName)
			}
		}
	}

	p.openAPIMux.RLock()
	openAPITarget, isOpenAPI := p.openAPITargets[serviceName]
	p.openAPIMux.RUnlock()

	if sessionID := r.Header.Get("Mcp-Session-Id"); sessionID != "" {
		p.trackSession(r.Context(), sessionID, agentID, agentKind, serviceName)
	}

	if isOpenAPI {
		p.handleOpenAPIRequest(w, r, openAPITarget, rpcReq, method, serviceName, agentID, agentKind, classID, allowedTools, agentCfg, reqStart)
		return
	}

	// Handle initialize at the gateway level — the gateway is the MCP server
	// from the client's perspective; downstream sessions are managed internally.
	if method == "initialize" {
		sessionID := fmt.Sprintf("sess_%d_%s", time.Now().UnixNano(), agentID)
		w.Header().Set("Mcp-Session-Id", sessionID)
		p.trackSession(r.Context(), sessionID, agentID, agentKind, serviceName)

		// Echo back the client's requested protocol version, defaulting to 2024-11-05
		clientProtocol := "2024-11-05"
		if params, ok := rpcReq["params"].(map[string]any); ok {
			if pv, ok := params["protocolVersion"].(string); ok && pv != "" {
				clientProtocol = pv
			}
		}

		res := map[string]any{
			"jsonrpc": "2.0",
			"id":      reqID,
			"result": map[string]any{
				"protocolVersion": clientProtocol,
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "reflex-gateway", "version": "1.0.0"},
			},
		}
		p.sendJSONRPCResponse(w, r, res)
		return
	}

	// Resolve target URL from service name (lock-safe; hot-reloadable)
	targetURL, ok := p.getTarget(serviceName)
	if !ok {
		targetURL = "http://localhost:9000"
	}

	if method == "tools/list" {
		// Always aggregate tools from all services
		p.handleAggregatedToolsList(w, r, bodyBytes, allowedTools)
		return
	}

	if method == "tools/call" {
		params, _ := rpcReq["params"].(map[string]any)
		toolName, _ := params["name"].(string)
		args, _ := params["arguments"].(map[string]any)

		amount, amountFound := p.extractAmount(agentCfg, toolName, args)

		allowed, denyStage, reason, timings, committedEntries := p.governCall(r.Context(), callKindTool, agentID, classID, agentKind, toolName, amount, amountFound, allowedTools, agentCfg, args)

		downstreamStart := time.Now()
		if allowed {
			if !p.proxyToTarget(w, r, targetURL, bodyBytes, serviceName) {
				// Downstream unreachable/5xx AFTER governance committed counters:
				// refund the budget and record a downstream-stage failure.
				p.rollbackCommittedEntries(r.Context(), committedEntries, agentID, toolName)
				allowed = false
				denyStage = "downstream"
				reason = fmt.Sprintf("downstream MCP server (%s) failed", targetURL)
			}
		} else {
			p.logger.Warn("mcp tool execution DENIED", "agent_id", agentID, "tool", toolName, "stage", denyStage, "reason", reason)
			p.sendErrorResponse(w, r, reqID, reason)
		}
		downstreamMs := ms(time.Since(downstreamStart))
		if !allowed {
			downstreamMs = 0
		}

		totalMs := ms(time.Since(reqStart))
		govOverheadMs := timings.GovernanceTotal

		decisionStr := map[bool]string{true: "allow", false: "deny"}[allowed]

		// Denied requests must not contribute to spend totals
		spendDeltaCents := int64(0)
		if allowed {
			spendDeltaCents = int64(amount * 100)
		}

		// Record Prometheus Metrics
		metrics.RequestDuration.WithLabelValues(toolName, classID, decisionStr).Observe(totalMs / 1000.0)
		metrics.GovernanceOverhead.WithLabelValues(toolName, decisionStr).Observe(govOverheadMs / 1000.0)
		if allowed {
			metrics.DownstreamDuration.WithLabelValues(serviceName, toolName).Observe(downstreamMs / 1000.0)
			metrics.SpendProcessed.WithLabelValues(agentID, classID).Add(amount * 100)
		}
		metrics.DecisionsTotal.WithLabelValues(toolName, classID, decisionStr, denyStage).Inc()

		// Publish event to Redis pub/sub for WebSocket streaming to frontend
		p.publishEvent(r.Context(), GovernanceEvent{
			Type:            "decision",
			AgentID:         agentID,
			AgentClassID:    classID,
			Tool:            toolName,
			Decision:        decisionStr,
			DenyStage:       denyStage,
			Reason:          reason,
			SpendDeltaCents: spendDeltaCents,
			Latency: map[string]float64{
				"total_ms":               totalMs,
				"killswitch_ms":          timings.KillswitchMs,
				"constraint_ms":          timings.ConstraintMs,
				"policy_ms":              timings.PolicyMs,
				"spend_ms":               timings.SpendCheckMs,
				"downstream_ms":          downstreamMs,
				"governance_overhead_ms": govOverheadMs,
			},
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		})

		// Write permanent audit log entry (sensitive params redacted)
		p.auditor.Log(&audit.Entry{
			AgentID:              agentID,
			AgentClassID:         classID,
			Action:               toolName,
			BankConnectionID:     serviceName,
			Params:               redactParams(args),
			Decision:             decisionStr,
			DenyStage:            denyStage,
			Reason:               reason,
			SpendDelta:           spendDeltaCents,
			TotalLatencyMs:       totalMs,
			KillswitchLatencyMs:  timings.KillswitchMs,
			PolicyLatencyMs:      timings.PolicyMs,
			SpendCheckLatencyMs:  timings.SpendCheckMs,
			ConstraintLatencyMs:  timings.ConstraintMs,
			DownstreamLatencyMs:  downstreamMs,
			GovernanceOverheadMs: govOverheadMs,
		})

		return
	}

	// Governed resource/prompt reads. These don't move money, but they ARE an
	// exfiltration / prompt-injection surface, so they go through the same
	// killswitch → constraints → OPA → rate-limit pipeline (no spend commit).
	if method == "resources/read" || method == "prompts/get" {
		kind := callKindResource
		if method == "prompts/get" {
			kind = callKindPrompt
		}
		params, _ := rpcReq["params"].(map[string]any)
		// Identify the action: resources use a URI, prompts use a name.
		actionName, _ := params["uri"].(string)
		if actionName == "" {
			actionName, _ = params["name"].(string)
		}

		// No monetary amount for resources/prompts; amountFound=false is fine
		// because governCall skips money-field enforcement for non-tools.
		allowed, denyStage, reason, timings, committedEntries := p.governCall(r.Context(), kind, agentID, classID, agentKind, actionName, 0, false, allowedTools, agentCfg, params)

		downstreamStart := time.Now()
		if allowed {
			if !p.proxyToTarget(w, r, targetURL, bodyBytes, serviceName) {
				p.rollbackCommittedEntries(r.Context(), committedEntries, agentID, actionName)
				allowed = false
				denyStage = "downstream"
				reason = fmt.Sprintf("downstream MCP server (%s) failed", targetURL)
			}
		} else {
			p.logger.Warn("mcp resource/prompt access DENIED", "agent_id", agentID, "kind", string(kind), "action", actionName, "stage", denyStage, "reason", reason)
			p.sendErrorResponse(w, r, reqID, reason)
		}
		downstreamMs := ms(time.Since(downstreamStart))
		if !allowed {
			downstreamMs = 0
		}

		totalMs := ms(time.Since(reqStart))
		govOverheadMs := timings.GovernanceTotal
		decisionStr := map[bool]string{true: "allow", false: "deny"}[allowed]

		metrics.RequestDuration.WithLabelValues(actionName, classID, decisionStr).Observe(totalMs / 1000.0)
		metrics.GovernanceOverhead.WithLabelValues(actionName, decisionStr).Observe(govOverheadMs / 1000.0)
		if allowed {
			metrics.DownstreamDuration.WithLabelValues(serviceName, actionName).Observe(downstreamMs / 1000.0)
		}
		metrics.DecisionsTotal.WithLabelValues(actionName, classID, decisionStr, denyStage).Inc()

		p.publishEvent(r.Context(), GovernanceEvent{
			Type:            "decision",
			AgentID:         agentID,
			AgentClassID:    classID,
			Tool:            actionName,
			Decision:        decisionStr,
			DenyStage:       denyStage,
			Reason:          reason,
			SpendDeltaCents: 0,
			Latency: map[string]float64{
				"total_ms":               totalMs,
				"killswitch_ms":          timings.KillswitchMs,
				"constraint_ms":          timings.ConstraintMs,
				"policy_ms":              timings.PolicyMs,
				"spend_ms":               timings.SpendCheckMs,
				"downstream_ms":          downstreamMs,
				"governance_overhead_ms": govOverheadMs,
			},
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		})

		p.auditor.Log(&audit.Entry{
			AgentID:              agentID,
			AgentClassID:         classID,
			Action:               fmt.Sprintf("%s:%s", method, actionName),
			BankConnectionID:     serviceName,
			Params:               redactParams(params),
			Decision:             decisionStr,
			DenyStage:            denyStage,
			Reason:               reason,
			SpendDelta:           0,
			TotalLatencyMs:       totalMs,
			KillswitchLatencyMs:  timings.KillswitchMs,
			PolicyLatencyMs:      timings.PolicyMs,
			SpendCheckLatencyMs:  timings.SpendCheckMs,
			ConstraintLatencyMs:  timings.ConstraintMs,
			DownstreamLatencyMs:  downstreamMs,
			GovernanceOverheadMs: govOverheadMs,
		})

		return
	}

	// Aggregated resources/list and prompts/list across all targets, filtered by
	// the agent's whitelist (same pattern as tools/list).
	if method == "resources/list" || method == "prompts/list" {
		p.handleAggregatedList(w, r, bodyBytes, method, allowedTools)
		return
	}

	p.proxyToTarget(w, r, targetURL, bodyBytes, serviceName)
}

// handleAggregatedList fans a resources/list or prompts/list request out to all
// native MCP targets, merges the results, dedupes by uri/name, and filters by
// the agent's allowed list. (OpenAPI virtual targets don't expose MCP
// resources/prompts, so only native targets are queried.)
func (p *MCPProxy) handleAggregatedList(w http.ResponseWriter, r *http.Request, bodyBytes []byte, method string, allowedTools []string) {
	allowedSet := make(map[string]bool)
	for _, t := range allowedTools {
		allowedSet[t] = true
	}

	var rpcReq map[string]any
	_ = json.Unmarshal(bodyBytes, &rpcReq)
	reqID := rpcReq["id"]

	// result key is "resources" for resources/list, "prompts" for prompts/list
	resultKey := "resources"
	idField := "uri"
	if method == "prompts/list" {
		resultKey = "prompts"
		idField = "name"
	}

	var merged []any
	seen := make(map[string]bool)
	seenURL := make(map[string]bool)
	p.rangeTargets(func(svcName, targetBaseURL string) {
		if svcName == "default" {
			return
		}
		targetURL := targetBaseURL
		if !strings.HasSuffix(targetURL, "/mcp") {
			targetURL = strings.TrimSuffix(targetURL, "/") + "/mcp"
		}
		if seenURL[targetURL] {
			return
		}
		seenURL[targetURL] = true

		items := p.fetchListFromTarget(r, targetURL, bodyBytes, resultKey)
		for _, item := range items {
			if m, ok := item.(map[string]any); ok {
				id, _ := m[idField].(string)
				if id == "" || seen[id] {
					continue
				}
				seen[id] = true
				if len(allowedTools) == 0 || allowedSet[id] {
					merged = append(merged, item)
				}
			}
		}
	})
	if merged == nil {
		merged = []any{}
	}

	res := map[string]any{
		"jsonrpc": "2.0",
		"id":      reqID,
		"result":  map[string]any{resultKey: merged},
	}
	p.sendJSONRPCResponse(w, r, res)
}

// fetchListFromTarget forwards a resources/list or prompts/list to a single
// native MCP downstream and returns the items array (empty on any failure).
func (p *MCPProxy) fetchListFromTarget(r *http.Request, targetURL string, bodyBytes []byte, resultKey string) []any {
	outReq, err := http.NewRequestWithContext(r.Context(), "POST", targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil
	}
	outReq.Header.Set("Content-Type", "application/json")
	outReq.Header.Set("Accept", "application/json, text/event-stream")
	if sessID := p.getOrCreateDownstreamSession(r.Context(), targetURL); sessID != "" {
		outReq.Header.Set("Mcp-Session-Id", sessID)
	}

	resp, err := p.client.Do(outReq)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}

	// Handle SSE-wrapped responses.
	body := string(respBytes)
	if strings.HasPrefix(body, "event:") || strings.Contains(body, "\ndata:") {
		for _, line := range strings.Split(body, "\n") {
			if strings.HasPrefix(line, "data:") {
				body = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
				break
			}
		}
	}

	var rpcResp map[string]any
	if err := json.Unmarshal([]byte(body), &rpcResp); err != nil {
		return nil
	}
	result, _ := rpcResp["result"].(map[string]any)
	items, _ := result[resultKey].([]any)
	return items
}

// callKind distinguishes what sort of MCP action is being governed, so the
// pipeline can skip money-field enforcement for actions that don't move money.
type callKind string

const (
	callKindTool     callKind = "tool"
	callKindResource callKind = "resource"
	callKindPrompt   callKind = "prompt"
)

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

	// Stage 2a: Declared money-field enforcement (FAIL CLOSED). A money-moving
	// tool — one that declares money_params or configures a cumulative_spend_cap
	// — MUST carry a parseable value in a declared field. If it doesn't, the
	// spend cap cannot be enforced, so the call is DENIED rather than silently
	// passed through as $0 (which is exactly how a renamed/omitted money field
	// would otherwise bypass every cap). Only applies to tools — resources and
	// prompts don't move money.
	if kind == callKindTool {
		if required, mp := p.constraintCheck.RequiresAmount(cfg, toolName); required && !amountFound {
			t.ConstraintMs = ms(time.Since(cStart))
			metrics.ConstraintCheckDuration.WithLabelValues(toolName).Observe(t.ConstraintMs / 1000.0)
			t.GovernanceTotal = t.KillswitchMs + t.ConstraintMs
			reason := fmt.Sprintf("action '%s' denied: missing or unparseable declared money field", toolName)
			if len(mp) > 0 {
				reason = fmt.Sprintf("action '%s' denied: no parseable value in declared money field(s) %v — spend cap cannot be enforced", toolName, mp)
			}
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
		if strings.HasPrefix(commitRes.Exceeded, "ratelimit:") || strings.HasPrefix(commitRes.Exceeded, "spendcap:") {
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
func (p *MCPProxy) rollbackCommittedEntries(ctx context.Context, entries []spend.Entry, agentID, toolName string) {
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

func (p *MCPProxy) handleOpenAPIRequest(
	w http.ResponseWriter,
	r *http.Request,
	target *OpenAPISpecTarget,
	rpcReq map[string]any,
	method string,
	serviceName string,
	agentID string,
	agentKind string,
	classID string,
	allowedTools []string,
	agentCfg *configcache.AgentConfig,
	reqStart time.Time,
) {
	reqID := rpcReq["id"]

	switch method {
	case "initialize":
		sessionID := fmt.Sprintf("sess_%d_%s", time.Now().UnixNano(), agentID)
		w.Header().Set("Mcp-Session-Id", sessionID)
		p.trackSession(r.Context(), sessionID, agentID, agentKind, serviceName)

		clientProtocol := "2024-11-05"
		if params, ok := rpcReq["params"].(map[string]any); ok {
			if pv, ok := params["protocolVersion"].(string); ok && pv != "" {
				clientProtocol = pv
			}
		}

		res := map[string]any{
			"jsonrpc": "2.0",
			"id":      reqID,
			"result": map[string]any{
				"protocolVersion": clientProtocol,
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "reflex-gateway", "version": "1.0.0"},
			},
		}
		p.sendJSONRPCResponse(w, r, res)

	case "notifications/initialized":
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusAccepted)

	case "tools/list":
		tools, err := adapter.SpecToMCPTools(target.Doc)
		if err != nil {
			p.sendErrorResponse(w, r, reqID, "failed to build openapi tool schema")
			return
		}

		filteredTools := []adapter.MCPTool{}
		if len(allowedTools) > 0 {
			allowedSet := make(map[string]bool)
			for _, t := range allowedTools {
				allowedSet[t] = true
			}
			for _, t := range tools {
				if allowedSet[t.Name] {
					filteredTools = append(filteredTools, t)
				}
			}
		} else {
			filteredTools = tools
		}

		res := map[string]any{
			"jsonrpc": "2.0",
			"id":      reqID,
			"result": map[string]any{
				"tools": filteredTools,
			},
		}
		p.sendJSONRPCResponse(w, r, res)

	case "tools/call":
		params, _ := rpcReq["params"].(map[string]any)
		toolName, _ := params["name"].(string)
		args, _ := params["arguments"].(map[string]any)

		// Use the shared extractor (declared money_params, else legacy amount/
		// amount_cents; handles float/int/string) so caps and the $1000 bound
		// aren't bypassed by non-float64 encodings or renamed money fields (G12).
		amount, amountFound := p.extractAmount(agentCfg, toolName, args)

		allowed, denyStage, reason, timings, committedEntries := p.governCall(r.Context(), callKindTool, agentID, classID, agentKind, toolName, amount, amountFound, allowedTools, agentCfg, args)

		downstreamStart := time.Now()
		var mcpResult map[string]any
		if allowed {
			restReq, err := adapter.BuildRESTRequest(target.BaseURL, target.Doc, toolName, args)
			if err != nil {
				// Downstream request construction failed after governance allowed:
				// refund the committed budget and record a downstream-stage failure.
				p.rollbackCommittedEntries(r.Context(), committedEntries, agentID, toolName)
				allowed = false
				denyStage = "downstream"
				reason = fmt.Sprintf("invalid tool arguments: %v", err)
				p.sendErrorResponse(w, r, reqID, reason)
			} else {
				restReq = restReq.WithContext(r.Context())
				// Inject the downstream bank's OWN credentials (never the agent's JWT).
				injectDownstreamAuth(restReq, p.authForConnection(serviceName))
				resp, err := p.client.Do(restReq)
				if err != nil {
					p.rollbackCommittedEntries(r.Context(), committedEntries, agentID, toolName)
					allowed = false
					denyStage = "downstream"
					reason = "downstream bank REST API unreachable"
					p.sendErrorResponse(w, r, reqID, reason)
				} else if resp.StatusCode >= 500 {
					// Downstream 5xx after governance committed: refund budget.
					// 4xx is a legitimate (if rejected) bank response and stays charged.
					resp.Body.Close()
					p.rollbackCommittedEntries(r.Context(), committedEntries, agentID, toolName)
					allowed = false
					denyStage = "downstream"
					reason = fmt.Sprintf("downstream bank REST API failed (HTTP %d)", resp.StatusCode)
					p.sendErrorResponse(w, r, reqID, reason)
				} else {
					mcpResult = adapter.RESTResponseToMCPResult(resp)
				}
			}
		} else {
			p.sendErrorResponse(w, r, reqID, reason)
		}
		downstreamMs := ms(time.Since(downstreamStart))
		if !allowed {
			downstreamMs = 0
		}

		totalMs := ms(time.Since(reqStart))
		govOverheadMs := timings.GovernanceTotal
		decisionStr := map[bool]string{true: "allow", false: "deny"}[allowed]

		// Denied requests must not contribute to spend totals
		spendDeltaCents := int64(0)
		if allowed {
			spendDeltaCents = int64(amount * 100)
		}

		// Record Prometheus Metrics (parity with the MCP tools/call path)
		metrics.RequestDuration.WithLabelValues(toolName, classID, decisionStr).Observe(totalMs / 1000.0)
		metrics.GovernanceOverhead.WithLabelValues(toolName, decisionStr).Observe(govOverheadMs / 1000.0)
		if allowed {
			metrics.DownstreamDuration.WithLabelValues(serviceName, toolName).Observe(downstreamMs / 1000.0)
			metrics.SpendProcessed.WithLabelValues(agentID, classID).Add(amount * 100)
		}
		metrics.DecisionsTotal.WithLabelValues(toolName, classID, decisionStr, denyStage).Inc()

		if allowed {
			res := map[string]any{"jsonrpc": "2.0", "id": reqID, "result": mcpResult}
			p.sendJSONRPCResponse(w, r, res)
		}

		p.publishEvent(r.Context(), GovernanceEvent{
			Type:            "decision",
			AgentID:         agentID,
			AgentClassID:    classID,
			Tool:            toolName,
			Decision:        decisionStr,
			DenyStage:       denyStage,
			Reason:          reason,
			SpendDeltaCents: spendDeltaCents,
			Latency: map[string]float64{
				"total_ms":               totalMs,
				"killswitch_ms":          timings.KillswitchMs,
				"constraint_ms":          timings.ConstraintMs,
				"policy_ms":              timings.PolicyMs,
				"spend_ms":               timings.SpendCheckMs,
				"downstream_ms":          downstreamMs,
				"governance_overhead_ms": govOverheadMs,
			},
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		})

		p.auditor.Log(&audit.Entry{
			AgentID:              agentID,
			AgentClassID:         classID,
			Action:               toolName,
			BankConnectionID:     serviceName,
			Params:               redactParams(args),
			Decision:             decisionStr,
			DenyStage:            denyStage,
			Reason:               reason,
			SpendDelta:           spendDeltaCents,
			TotalLatencyMs:       totalMs,
			KillswitchLatencyMs:  timings.KillswitchMs,
			PolicyLatencyMs:      timings.PolicyMs,
			SpendCheckLatencyMs:  timings.SpendCheckMs,
			ConstraintLatencyMs:  timings.ConstraintMs,
			DownstreamLatencyMs:  downstreamMs,
			GovernanceOverheadMs: govOverheadMs,
		})

	default:
		p.sendErrorResponse(w, r, reqID, fmt.Sprintf("method '%s' not supported", method))
	}
}

func (p *MCPProxy) publishEvent(ctx context.Context, event GovernanceEvent) {
	data, err := json.Marshal(event)
	if err == nil {
		p.rdb.Publish(ctx, "gateway:events", string(data))
	}
}

func (p *MCPProxy) sendJSONRPCResponse(w http.ResponseWriter, r *http.Request, res map[string]any) {
	b, _ := json.Marshal(res)
	if prefersSSE(r) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "event: message\ndata: %s\n\n", string(b))
	} else {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write(b)
	}
}

// prefersSSE returns true if the client's Accept header lists text/event-stream
// before application/json, indicating SSE is the preferred transport.
func prefersSSE(r *http.Request) bool {
	accept := r.Header.Get("Accept")
	sseIdx := strings.Index(accept, "text/event-stream")
	jsonIdx := strings.Index(accept, "application/json")
	if sseIdx == -1 {
		return false
	}
	if jsonIdx == -1 {
		return true
	}
	return sseIdx < jsonIdx
}

func (p *MCPProxy) sendErrorResponse(w http.ResponseWriter, r *http.Request, reqID any, reason string) {
	// Marshal the inner payload so a reason containing quotes/backslashes can't
	// produce invalid JSON (G20).
	innerJSON, _ := json.Marshal(map[string]any{"allow": false, "reason": reason})
	errResp := map[string]any{
		"jsonrpc": "2.0",
		"id":      reqID,
		"result": map[string]any{
			"content": []map[string]any{
				{
					"type": "text",
					"text": string(innerJSON),
				},
			},
			"isError": true,
		},
	}
	errJSON, _ := json.Marshal(errResp)
	if prefersSSE(r) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "event: message\ndata: %s\n\n", string(errJSON))
	} else {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write(errJSON)
	}
}

// handleAggregatedToolsList fetches tools/list from all registered services
// (native MCP targets + OpenAPI virtual targets), merges them, filters by the
// agent's allowed tools, and returns a single combined response.
func (p *MCPProxy) handleAggregatedToolsList(w http.ResponseWriter, r *http.Request, bodyBytes []byte, allowedTools []string) {
	allowedSet := make(map[string]bool)
	for _, t := range allowedTools {
		allowedSet[t] = true
	}

	var allTools []any
	var rpcReq map[string]any
	_ = json.Unmarshal(bodyBytes, &rpcReq)
	reqID := rpcReq["id"]

	// 1. Fetch from native MCP targets
	seen := make(map[string]bool)
	p.rangeTargets(func(svcName, targetBaseURL string) {
		if svcName == "default" {
			return
		}
		targetURL := targetBaseURL
		if !strings.HasSuffix(targetURL, "/mcp") {
			targetURL = strings.TrimSuffix(targetURL, "/") + "/mcp"
		}
		if seen[targetURL] {
			return
		}
		seen[targetURL] = true

		tools := p.fetchToolsFromTarget(r, targetURL, bodyBytes)
		allTools = append(allTools, tools...)
	})

	// 2. Fetch from OpenAPI virtual targets
	p.openAPIMux.RLock()
	for _, target := range p.openAPITargets {
		mcpTools, err := adapter.SpecToMCPTools(target.Doc)
		if err != nil {
			continue
		}
		for _, t := range mcpTools {
			toolMap := map[string]any{
				"name":        t.Name,
				"description": t.Description,
				"inputSchema": t.InputSchema,
			}
			allTools = append(allTools, toolMap)
		}
	}
	p.openAPIMux.RUnlock()

	// 3. Dedupe by tool NAME (not URL): two connections can expose the same
	// tool name, but tools/call routing resolves a name to exactly one
	// connection (agp:tool_routing, last-write-wins). Advertising duplicates
	// would show the agent a tool that silently routes elsewhere. First
	// occurrence wins, matching the routing map's effective owner.
	seenNames := make(map[string]bool)
	var deduped []any
	for _, tool := range allTools {
		if toolMap, ok := tool.(map[string]any); ok {
			name, _ := toolMap["name"].(string)
			if name == "" || seenNames[name] {
				continue
			}
			seenNames[name] = true
			deduped = append(deduped, tool)
		}
	}

	// 4. Filter by allowed tools
	var filtered []any
	for _, tool := range deduped {
		if toolMap, ok := tool.(map[string]any); ok {
			name, _ := toolMap["name"].(string)
			if len(allowedTools) == 0 || allowedSet[name] {
				filtered = append(filtered, tool)
			}
		}
	}
	if filtered == nil {
		filtered = []any{}
	}

	res := map[string]any{
		"jsonrpc": "2.0",
		"id":      reqID,
		"result":  map[string]any{"tools": filtered},
	}
	p.sendJSONRPCResponse(w, r, res)
}

// fetchToolsFromTarget fetches tools/list from a single native MCP downstream.
// Handles session termination by retrying with a fresh session.
func (p *MCPProxy) fetchToolsFromTarget(r *http.Request, targetURL string, bodyBytes []byte) []any {
	tools, terminated := p.doFetchTools(r, targetURL, bodyBytes, false)
	if terminated {
		p.logger.Info("downstream session terminated during tools/list, re-initializing", "target", targetURL)
		p.invalidateDownstreamSession(r.Context(), targetURL)
		tools, _ = p.doFetchTools(r, targetURL, bodyBytes, true)
	}
	return tools
}

func (p *MCPProxy) doFetchTools(r *http.Request, targetURL string, bodyBytes []byte, forceNewSession bool) ([]any, bool) {
	outReq, err := http.NewRequestWithContext(r.Context(), "POST", targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, false
	}
	outReq.Header.Set("Content-Type", "application/json")
	outReq.Header.Set("Accept", "application/json, text/event-stream")

	if forceNewSession {
		if sessID := p.createDownstreamSession(r.Context(), targetURL); sessID != "" {
			outReq.Header.Set("Mcp-Session-Id", sessID)
		}
	} else if sessID := p.getOrCreateDownstreamSession(r.Context(), targetURL); sessID != "" {
		outReq.Header.Set("Mcp-Session-Id", sessID)
	}

	resp, err := p.client.Do(outReq)
	if err != nil {
		p.logger.Warn("failed to fetch tools from target", "url", targetURL, "error", err)
		return nil, false
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, false
	}

	// Check for session termination
	if strings.Contains(string(respBytes), "Session has been terminated") {
		return nil, true
	}

	rawStr := strings.TrimSpace(string(respBytes))
	if strings.HasPrefix(rawStr, "event: message") {
		idx := strings.Index(rawStr, "data: ")
		if idx != -1 {
			rawStr = strings.TrimSpace(rawStr[idx+6:])
		}
	}

	var jsonResp map[string]any
	if err := json.Unmarshal([]byte(rawStr), &jsonResp); err != nil {
		return nil, false
	}

	result, ok := jsonResp["result"].(map[string]any)
	if !ok {
		return nil, false
	}
	tools, ok := result["tools"].([]any)
	if !ok {
		return nil, false
	}
	return tools, false
}

func (p *MCPProxy) getOrCreateDownstreamSession(ctx context.Context, targetURL string) string {
	if p.rdb != nil {
		key := fmt.Sprintf("mcp:auto_session:%s", targetURL)
		if val, err := p.rdb.Get(ctx, key).Result(); err == nil && val != "" {
			return val
		}
	}

	initBody, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{},
			"clientInfo":      map[string]any{"name": "reflex-gateway", "version": "1.0.0"},
		},
	})

	initReq, err := http.NewRequestWithContext(ctx, "POST", targetURL, bytes.NewReader(initBody))
	if err != nil {
		return ""
	}
	initReq.Header.Set("Content-Type", "application/json")
	initReq.Header.Set("Accept", "application/json, text/event-stream")

	resp, err := p.client.Do(initReq)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	sessID := resp.Header.Get("Mcp-Session-Id")
	if sessID != "" && p.rdb != nil {
		key := fmt.Sprintf("mcp:auto_session:%s", targetURL)
		p.rdb.Set(ctx, key, sessID, 1*time.Hour)
	}

	return sessID
}

// proxyToTarget forwards the request downstream and writes the response.
// Returns false when the downstream exchange failed (unreachable, read error,
// or 5xx) so callers can roll back any governance counters committed in
// governCall — a failed downstream call must not consume budget.
func (p *MCPProxy) proxyToTarget(w http.ResponseWriter, r *http.Request, targetBaseURL string, bodyBytes []byte, serviceName ...string) bool {
	targetURL := targetBaseURL
	if !strings.HasSuffix(targetBaseURL, "/mcp") {
		targetURL = strings.TrimSuffix(targetBaseURL, "/") + "/mcp"
	}
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	connID := ""
	if len(serviceName) > 0 {
		connID = serviceName[0]
	}

	resp := p.doProxyRequest(r, targetURL, bodyBytes, false, connID)
	if resp == nil {
		p.logger.Error("failed to reach target MCP Server", "target", targetBaseURL)
		p.sendErrorResponse(w, r, nil, fmt.Sprintf("downstream MCP Server (%s) unreachable", targetBaseURL))
		return false
	}
	defer resp.Body.Close()

	// Read the response body to check for session errors
	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		p.sendErrorResponse(w, r, nil, "error reading downstream response")
		return false
	}

	// Detect "Session has been terminated" and retry with a fresh session
	if strings.Contains(string(respBytes), "Session has been terminated") {
		p.logger.Info("downstream session terminated, re-initializing", "target", targetURL)
		p.invalidateDownstreamSession(r.Context(), targetURL)
		resp.Body.Close()

		resp2 := p.doProxyRequest(r, targetURL, bodyBytes, true, connID)
		if resp2 == nil {
			p.sendErrorResponse(w, r, nil, fmt.Sprintf("downstream MCP Server (%s) unreachable", targetBaseURL))
			return false
		}
		defer resp2.Body.Close()
		respBytes, err = io.ReadAll(resp2.Body)
		if err != nil {
			p.sendErrorResponse(w, r, nil, "error reading downstream response")
			return false
		}
		for k, vv := range resp2.Header {
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp2.StatusCode)
		w.Write(respBytes)
		return resp2.StatusCode < 500
	}

	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	w.Write(respBytes)
	return resp.StatusCode < 500
}

// doProxyRequest forwards the request to the downstream target, managing the
// downstream session. If forceNewSession is true, skips the cached session.
// connID identifies the bank connection so its downstream credentials (if any)
// can be injected — the agent's JWT is stripped, the bank's OWN auth is added.
func (p *MCPProxy) doProxyRequest(r *http.Request, targetURL string, bodyBytes []byte, forceNewSession bool, connID string) *http.Response {
	outReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil
	}

	for k, vv := range r.Header {
		// Don't forward the client's session ID — the gateway manages downstream sessions.
		// Don't forward the agent's Authorization header either: the JWT is the
		// gateway's trust boundary and must never leak to downstream bank servers.
		if strings.EqualFold(k, "Mcp-Session-Id") || strings.EqualFold(k, "Authorization") {
			continue
		}
		for _, v := range vv {
			outReq.Header.Add(k, v)
		}
	}
	outReq.Header.Set("X-Forwarded-By", "agp-gateway")

	// Inject the downstream bank server's OWN credentials (never the agent's JWT).
	if connID != "" {
		injectDownstreamAuth(outReq, p.authForConnection(connID))
	}

	if forceNewSession {
		if sessID := p.createDownstreamSession(r.Context(), targetURL); sessID != "" {
			outReq.Header.Set("Mcp-Session-Id", sessID)
		}
	} else if sessID := p.getOrCreateDownstreamSession(r.Context(), targetURL); sessID != "" {
		outReq.Header.Set("Mcp-Session-Id", sessID)
	}

	resp, err := p.client.Do(outReq)
	if err != nil {
		return nil
	}
	return resp
}

// invalidateDownstreamSession removes the cached session for a target.
func (p *MCPProxy) invalidateDownstreamSession(ctx context.Context, targetURL string) {
	if p.rdb != nil {
		key := fmt.Sprintf("mcp:auto_session:%s", targetURL)
		p.rdb.Del(ctx, key)
	}
}

// createDownstreamSession initializes a new session with the downstream and caches it.
func (p *MCPProxy) createDownstreamSession(ctx context.Context, targetURL string) string {
	initBody, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{},
			"clientInfo":      map[string]any{"name": "reflex-gateway", "version": "1.0.0"},
		},
	})

	initReq, err := http.NewRequestWithContext(ctx, "POST", targetURL, bytes.NewReader(initBody))
	if err != nil {
		return ""
	}
	initReq.Header.Set("Content-Type", "application/json")
	initReq.Header.Set("Accept", "application/json, text/event-stream")

	resp, err := p.client.Do(initReq)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	sessID := resp.Header.Get("Mcp-Session-Id")
	if sessID != "" && p.rdb != nil {
		key := fmt.Sprintf("mcp:auto_session:%s", targetURL)
		p.rdb.Set(ctx, key, sessID, 1*time.Hour)
	}
	return sessID
}

// extractIdentity authenticates the caller. A valid Bearer JWT is REQUIRED;
// identity is derived solely from the validated token claims. The X-Agent-ID
// header is accepted only as an optional consistency cross-check — if present
// and it disagrees with the token's agent_id, the request is rejected. The
// header alone is never sufficient to establish identity.
func (p *MCPProxy) extractIdentity(r *http.Request) (string, string, error) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return "", "", fmt.Errorf("missing Authorization header (Bearer JWT required)")
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")
	claims, err := p.jwtMgr.Validate(token)
	if err != nil {
		return "", "", fmt.Errorf("invalid or expired token: %v", err)
	}

	// Optional cross-check: if the caller also asserts an agent id via header,
	// it must match the token's identity (prevents confused-deputy mistakes).
	if headerAgentID := r.Header.Get("X-Agent-ID"); headerAgentID != "" && headerAgentID != claims.AgentID {
		return "", "", fmt.Errorf("X-Agent-ID header does not match authenticated token identity")
	}

	return claims.AgentID, claims.AgentKind, nil
}

func (p *MCPProxy) trackSession(ctx context.Context, sessionID, agentID, agentKind, service string) {
	if sessionID == "" || p.rdb == nil {
		return
	}
	key := fmt.Sprintf("mcp:session:%s", sessionID)
	data, _ := json.Marshal(map[string]any{
		"session_id": sessionID,
		"agent_id":   agentID,
		"agent_kind": agentKind,
		"service":    service,
		"updated_at": time.Now().UTC().Format(time.RFC3339),
	})
	// SetNX so the ActiveSessions gauge only increments for a genuinely NEW
	// session, not on every request that re-uses an existing session ID —
	// otherwise the gauge grows monotonically and never reflects reality.
	// The key keeps a 24h TTL; when it expires the session is gone and a later
	// re-registration counts as new again.
	wasNew, err := p.rdb.SetNX(ctx, key, string(data), 24*time.Hour).Result()
	if err == nil && wasNew {
		metrics.ActiveSessions.Inc()
	} else if err == nil {
		// Existing session: refresh the TTL without double-counting.
		p.rdb.Expire(ctx, key, 24*time.Hour)
	}
}

// sensitiveParamKeys are argument keys whose values must never be persisted to
// the audit log or published to the event stream (credentials, tokens, secrets).
var sensitiveParamKeys = map[string]bool{
	"bearer_token":  true,
	"token":         true,
	"password":      true,
	"secret":        true,
	"api_key":       true,
	"apikey":        true,
	"authorization": true,
	"private_key":   true,
	"client_secret": true,
}

// redactParams returns a copy of the params map with sensitive values replaced
// by "[REDACTED]". The audit log and event stream must never store bearer
// tokens or credentials in plaintext.
func redactParams(params map[string]any) map[string]any {
	if params == nil {
		return nil
	}
	out := make(map[string]any, len(params))
	for k, v := range params {
		if sensitiveParamKeys[strings.ToLower(k)] {
			out[k] = "[REDACTED]"
		} else {
			out[k] = v
		}
	}
	return out
}

func ms(d time.Duration) float64 {
	return float64(d.Microseconds()) / 1000.0
}

// extractAmount resolves a call's monetary value in major currency units using
// the tool's DECLARED money_params (falling back to the legacy amount/
// amount_cents heuristic when none are declared). found reports whether a
// parseable amount was present, letting governCall fail closed on money-moving
// tools that omit their declared field instead of treating them as $0. All
// money extraction routes through constraints.ExtractAmountCents so the proxy
// (OPA input, metrics, hierarchical caps) and the spend-cap counter can never
// disagree on the amount.
func (p *MCPProxy) extractAmount(cfg *configcache.AgentConfig, toolName string, args map[string]any) (float64, bool) {
	cents, found := constraints.ExtractAmountCents(args, p.constraintCheck.MoneyParams(cfg, toolName))
	return cents / 100.0, found
}
