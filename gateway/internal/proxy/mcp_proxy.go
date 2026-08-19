// Package proxy implements an in-flight MCP Security Interceptor & Proxy with multi-server routing,
// Agent Profile/ABAC tool whitelisting, dynamic constraints/caps, OpenAPI-to-MCP virtualization,
// high-precision per-stage latency metrics, and Redis pub/sub event publishing.
//
// The package is split across several files:
//   - mcp_proxy.go   – struct, constructor, ServeHTTP dispatch, connection/target loading
//   - governance.go   – governCall pipeline, spend scopes, rollback, recordOutcome telemetry
//   - handlers.go     – handleOpenAPIRequest, aggregated tools/list, resources/list, prompts/list
//   - downstream.go   – proxyToTarget, doProxyRequest, session management, tool fetching
//   - helpers.go      – JSON-RPC response helpers, identity, auth injection, redaction, utilities
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

	"github.com/agp/gateway/internal/audit"
	"github.com/agp/gateway/internal/authn"
	"github.com/agp/gateway/internal/authz"
	"github.com/agp/gateway/internal/configcache"
	"github.com/agp/gateway/internal/constraints"
	"github.com/agp/gateway/internal/killswitch"
	"github.com/agp/gateway/internal/spend"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/redis/go-redis/v9"
)

// OpenAPISpecTarget pairs a parsed OpenAPI document with its base URL for
// REST-to-MCP translation.
type OpenAPISpecTarget struct {
	BaseURL string
	Doc     *openapi3.T
}

// GovernanceTimings records per-stage latency (in milliseconds) for a single
// governance pipeline execution.
type GovernanceTimings struct {
	KillswitchMs    float64
	ConstraintMs    float64
	PolicyMs        float64
	SpendCheckMs    float64
	GovernanceTotal float64
}

// GovernanceEvent is the payload published to Redis pub/sub for real-time
// frontend streaming.
type GovernanceEvent struct {
	Type            string             `json:"type"`
	AgentID         string             `json:"agent_id"`
	AgentClassID    string             `json:"agent_class_id"`
	Tool            string             `json:"tool"`
	Decision        string             `json:"decision"`
	DenyStage       string             `json:"deny_stage"`
	Reason          string             `json:"reason"`
	SpendDeltaCents int64              `json:"spend_delta_cents"`
	ResponseData    any                `json:"response_data,omitempty"`
	Latency         map[string]float64 `json:"latency"`
	Timestamp       string             `json:"timestamp"`
}

// callKind distinguishes what sort of MCP action is being governed, so the
// pipeline can skip money-field enforcement for actions that don't move money.
type callKind string

const (
	callKindTool     callKind = "tool"
	callKindResource callKind = "resource"
	callKindPrompt   callKind = "prompt"
)

// MCPProxy is the core gateway component: an HTTP handler that intercepts MCP
// JSON-RPC requests, runs them through the governance pipeline, and proxies
// allowed calls to downstream MCP or REST servers.
type MCPProxy struct {
	targets            map[string]string // populated exclusively from Redis agp:connections
	targetsMux         sync.RWMutex
	openAPITargets     map[string]*OpenAPISpecTarget
	openAPIMux         sync.RWMutex
	connAuth           map[string]*downstreamAuth // connection_id → downstream creds
	connAuthMux        sync.RWMutex
	toolRouting        map[string]string // tool_name → service/connection_id
	toolRoutingMux     sync.RWMutex
	promptRouting      map[string]string // prompt_name → service/connection_id
	promptRoutingMux   sync.RWMutex
	resourceRouting    map[string]string // resource_uri → service/connection_id
	resourceRoutingMux sync.RWMutex
	ks                 *killswitch.Switch
	policyEngine       *authz.Engine
	spendLimiter       *spend.Limiter
	constraintCheck    *constraints.Checker
	configCache        *configcache.ConfigCache
	auditor            *audit.Logger
	jwtMgr             *authn.JWTManager
	rdb                *redis.Client
	logger             *slog.Logger
	client             *http.Client
}

// NewMCPProxy creates a governance-enforcing MCP proxy with the given
// dependencies.
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
		openAPITargets:  make(map[string]*OpenAPISpecTarget),
		connAuth:        make(map[string]*downstreamAuth),
		toolRouting:     make(map[string]string),
		promptRouting:   make(map[string]string),
		resourceRouting: make(map[string]string),
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

// --- Connection / Target Loading ---

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
		doc, err := loadSpec([]byte(conn.OpenAPISpec))
		if err != nil {
			p.logger.Warn("skipping unparsable openapi spec", "connection", id, "error", err)
			continue
		}
		baseURL := conn.BaseURL
		if baseURL == "" {
			p.logger.Warn("skipping openapi connection with empty base_url", "connection", id)
			continue
		}
		newTargets[id] = &OpenAPISpecTarget{BaseURL: baseURL, Doc: doc}
	}

	p.openAPIMux.Lock()
	p.openAPITargets = newTargets
	p.openAPIMux.Unlock()
	p.logger.Info("loaded openapi virtual targets", "count", len(newTargets))
}

// loadSpec wraps adapter.LoadSpec so the proxy doesn't import the adapter
// package directly in the main file (the adapter is only needed for spec
// parsing and REST translation, which live in handlers.go).
func loadSpec(data []byte) (*openapi3.T, error) {
	loader := openapi3.NewLoader()
	return loader.LoadFromData(data)
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

// LoadNativeTargets rebuilds the native-MCP target map exclusively from
// bank_connections cached in Redis (agp:connections). MCP targets are
// user-managed data registered via the Control Center UI — they are never
// sourced from environment variables.
func (p *MCPProxy) LoadNativeTargets(ctx context.Context) {
	targets := make(map[string]string)

	if p.rdb != nil {
		raw, err := p.rdb.Get(ctx, "agp:connections").Result()
		if err == nil && raw != "" {
			var mapping map[string]connectionEntry
			if err := json.Unmarshal([]byte(raw), &mapping); err == nil {
				for id, conn := range mapping {
					if conn.SourceType == "native_mcp" && conn.MCPURL != "" {
						targets[id] = conn.MCPURL
					}
				}
			}
		}
	}

	p.targetsMux.Lock()
	p.targets = targets
	p.targetsMux.Unlock()
	p.logger.Info("loaded native mcp targets from db/redis", "count", len(targets))
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

// LoadPromptRouting reads the prompt_name → connection_id mapping from Redis.
// This enables the gateway to route prompts/get to the correct downstream.
func (p *MCPProxy) LoadPromptRouting(ctx context.Context) {
	if p.rdb == nil {
		return
	}
	raw, err := p.rdb.Get(ctx, "agp:prompt_routing").Result()
	if err != nil || raw == "" {
		return
	}
	var mapping map[string]string
	if err := json.Unmarshal([]byte(raw), &mapping); err != nil {
		p.logger.Warn("failed to parse agp:prompt_routing", "error", err)
		return
	}
	p.promptRoutingMux.Lock()
	p.promptRouting = mapping
	p.promptRoutingMux.Unlock()
	p.logger.Info("loaded prompt routing map", "count", len(mapping))
}

// resolveServiceForPrompt returns the connection_id that owns the given prompt.
func (p *MCPProxy) resolveServiceForPrompt(promptName string) string {
	p.promptRoutingMux.RLock()
	defer p.promptRoutingMux.RUnlock()
	return p.promptRouting[promptName]
}

// LoadResourceRouting reads the resource_uri → connection_id mapping from Redis.
// This enables the gateway to route resources/read to the correct downstream.
func (p *MCPProxy) LoadResourceRouting(ctx context.Context) {
	if p.rdb == nil {
		return
	}
	raw, err := p.rdb.Get(ctx, "agp:resource_routing").Result()
	if err != nil || raw == "" {
		return
	}
	var mapping map[string]string
	if err := json.Unmarshal([]byte(raw), &mapping); err != nil {
		p.logger.Warn("failed to parse agp:resource_routing", "error", err)
		return
	}
	p.resourceRoutingMux.Lock()
	p.resourceRouting = mapping
	p.resourceRoutingMux.Unlock()
	p.logger.Info("loaded resource routing map", "count", len(mapping))
}

// resolveServiceForResource returns the connection_id that owns the given resource URI.
func (p *MCPProxy) resolveServiceForResource(uri string) string {
	p.resourceRoutingMux.RLock()
	defer p.resourceRoutingMux.RUnlock()
	return p.resourceRouting[uri]
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
			p.LoadPromptRouting(ctx)
			p.LoadResourceRouting(ctx)
			p.LoadNativeTargets(ctx)
			p.loadConnectionAuth(ctx)
		}
	}
}

// --- ServeHTTP: MCP JSON-RPC Dispatch ---

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

	// Resolve the target service via routing maps. tools/call resolves by tool
	// name, prompts/get by prompt name, resources/read by resource URI.
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
	} else if method == "prompts/get" {
		params, _ := rpcReq["params"].(map[string]any)
		promptName, _ := params["name"].(string)
		if promptName != "" {
			if resolved := p.resolveServiceForPrompt(promptName); resolved != "" {
				serviceName = resolved
				p.logger.Debug("resolved service via prompt routing", "prompt", promptName, "service", serviceName)
			}
		}
	} else if method == "resources/read" {
		params, _ := rpcReq["params"].(map[string]any)
		uri, _ := params["uri"].(string)
		if uri != "" {
			if resolved := p.resolveServiceForResource(uri); resolved != "" {
				serviceName = resolved
				p.logger.Debug("resolved service via resource routing", "uri", uri, "service", serviceName)
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

		// Echo back the client's requested protocol version, defaulting to 2025-06-18
		clientProtocol := "2025-06-18"
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
				"capabilities": map[string]any{
					"tools":     map[string]any{},
					"prompts":   map[string]any{},
					"resources": map[string]any{},
				},
				"serverInfo": map[string]any{"name": "reflex-gateway", "version": "1.0.0"},
			},
		}
		p.sendJSONRPCResponse(w, r, res)
		return
	}

	if method == "tools/list" {
		// Always aggregate tools from all services
		p.handleAggregatedToolsList(w, r, bodyBytes, allowedTools)
		return
	}

	// Aggregated resources/list and prompts/list across all targets, filtered by
	// the agent's whitelist (same pattern as tools/list).
	if method == "resources/list" || method == "prompts/list" {
		p.handleAggregatedList(w, r, bodyBytes, method, allowedTools)
		return
	}

	// Resolve target URL from service name (lock-safe; hot-reloadable)
	targetURL, ok := p.getTarget(serviceName)
	if !ok {
		p.logger.Warn("no downstream target configured for service", "service", serviceName, "agent_id", agentID)
		p.sendErrorResponse(w, r, reqID, fmt.Sprintf("no downstream MCP target configured for service %q — register a bank connection via the Control Center", serviceName))
		return
	}

	if method == "tools/call" {
		p.handleToolsCall(w, r, rpcReq, reqID, targetURL, bodyBytes, serviceName, agentID, agentKind, classID, allowedTools, agentCfg, reqStart)
		return
	}

	// Governed resource/prompt reads. These don't move money, but they ARE an
	// exfiltration / prompt-injection surface, so they go through the same
	// killswitch → constraints → OPA → rate-limit pipeline (no spend commit).
	if method == "resources/read" || method == "prompts/get" {
		p.handleGovernedRead(w, r, rpcReq, reqID, method, targetURL, bodyBytes, serviceName, agentID, agentKind, classID, allowedTools, agentCfg, reqStart)
		return
	}

	p.proxyToTarget(w, r, targetURL, bodyBytes, serviceName)
}

// handleToolsCall processes an MCP tools/call request through the governance
// pipeline and proxies allowed calls to the downstream native MCP target.
func (p *MCPProxy) handleToolsCall(
	w http.ResponseWriter, r *http.Request,
	rpcReq map[string]any, reqID any,
	targetURL string, bodyBytes []byte,
	serviceName, agentID, agentKind, classID string,
	allowedTools []string, agentCfg *configcache.AgentConfig,
	reqStart time.Time,
) {
	params, _ := rpcReq["params"].(map[string]any)
	toolName, _ := params["name"].(string)
	args, _ := params["arguments"].(map[string]any)

	amount, _ := p.extractAmount(agentCfg, toolName, args)

	allowed, denyStage, reason, timings, committedEntries := p.governCall(r.Context(), callKindTool, agentID, classID, agentKind, toolName, amount, allowedTools, agentCfg, args)

	downstreamStart := time.Now()
	var responseData any
	if allowed {
		ok, respBytes := p.proxyToTarget(w, r, targetURL, bodyBytes, serviceName)
		if !ok {
			// Downstream unreachable/5xx AFTER governance committed counters:
			// refund the budget and record a downstream-stage failure.
			p.rollbackCommittedEntries(committedEntries, agentID, toolName)
			allowed = false
			denyStage = "downstream"
			reason = fmt.Sprintf("downstream MCP server (%s) failed", targetURL)
		} else {
			responseData = p.parseResponseData(respBytes)
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

	// Denied requests must not contribute to spend totals
	spendDeltaCents := int64(0)
	if allowed {
		spendDeltaCents = int64(amount * 100)
	}

	p.recordOutcome(r.Context(), &outcomeParams{
		agentID:      agentID,
		classID:      classID,
		actionName:   toolName,
		serviceName:  serviceName,
		allowed:      allowed,
		denyStage:    denyStage,
		reason:       reason,
		spendDelta:   spendDeltaCents,
		timings:      timings,
		downstreamMs: downstreamMs,
		totalMs:      totalMs,
		params:       args,
		responseData: responseData,
	})
}

// handleGovernedRead processes resources/read and prompts/get requests through
// the governance pipeline and proxies allowed calls downstream.
func (p *MCPProxy) handleGovernedRead(
	w http.ResponseWriter, r *http.Request,
	rpcReq map[string]any, reqID any, method string,
	targetURL string, bodyBytes []byte,
	serviceName, agentID, agentKind, classID string,
	allowedTools []string, agentCfg *configcache.AgentConfig,
	reqStart time.Time,
) {
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

	// No monetary amount for resources/prompts.
	allowed, denyStage, reason, timings, committedEntries := p.governCall(r.Context(), kind, agentID, classID, agentKind, actionName, 0, allowedTools, agentCfg, params)

	downstreamStart := time.Now()
	var responseData any
	if allowed {
		ok, respBytes := p.proxyToTarget(w, r, targetURL, bodyBytes, serviceName)
		if !ok {
			p.rollbackCommittedEntries(committedEntries, agentID, actionName)
			allowed = false
			denyStage = "downstream"
			reason = fmt.Sprintf("downstream MCP server (%s) failed", targetURL)
		} else {
			responseData = p.parseResponseData(respBytes)
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

	p.recordOutcome(r.Context(), &outcomeParams{
		agentID:      agentID,
		classID:      classID,
		actionName:   fmt.Sprintf("%s:%s", method, actionName),
		serviceName:  serviceName,
		allowed:      allowed,
		denyStage:    denyStage,
		reason:       reason,
		spendDelta:   0,
		timings:      timings,
		downstreamMs: downstreamMs,
		totalMs:      totalMs,
		responseData: responseData,
		params:       params,
	})
}
