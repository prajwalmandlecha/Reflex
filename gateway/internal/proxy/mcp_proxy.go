// Package proxy implements an in-flight MCP Security Interceptor & Proxy with multi-server routing,
// Agent Profile/ABAC tool whitelisting, dynamic tools/list discovery filtering, and OpenAPI-to-MCP virtualization.
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
	"github.com/agp/gateway/internal/agent"
	"github.com/agp/gateway/internal/audit"
	"github.com/agp/gateway/internal/authn"
	"github.com/agp/gateway/internal/authz"
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

type MCPProxy struct {
	targets        map[string]string
	openAPITargets map[string]*OpenAPISpecTarget
	openAPIMux     sync.RWMutex
	ks             *killswitch.Switch
	policyEngine   *authz.Engine
	spendLimiter   *spend.Limiter
	auditor        *audit.Logger
	jwtMgr         *authn.JWTManager
	agentStore     *agent.Store
	rdb            *redis.Client
	logger         *slog.Logger
	client         *http.Client
}

func NewMCPProxy(
	targets map[string]string,
	ks *killswitch.Switch,
	policyEngine *authz.Engine,
	spendLimiter *spend.Limiter,
	auditor *audit.Logger,
	jwtMgr *authn.JWTManager,
	agentStore *agent.Store,
	rdb *redis.Client,
	logger *slog.Logger,
) *MCPProxy {
	return &MCPProxy{
		targets:        targets,
		openAPITargets: make(map[string]*OpenAPISpecTarget),
		ks:             ks,
		policyEngine:   policyEngine,
		spendLimiter:   spendLimiter,
		auditor:        auditor,
		jwtMgr:         jwtMgr,
		agentStore:     agentStore,
		rdb:            rdb,
		logger:         logger,
		client:         &http.Client{Timeout: 15 * time.Second},
	}
}

// RegisterOpenAPISpec registers an OpenAPI spec to be dynamically virtualized as an MCP server at /mcp/<serviceName>.
func (p *MCPProxy) RegisterOpenAPISpec(serviceName string, baseURL string, specData []byte) error {
	doc, err := adapter.LoadSpec(specData)
	if err != nil {
		return fmt.Errorf("failed to parse openapi spec for service '%s': %w", serviceName, err)
	}

	p.openAPIMux.Lock()
	defer p.openAPIMux.Unlock()
	p.openAPITargets[serviceName] = &OpenAPISpecTarget{
		BaseURL: baseURL,
		Doc:     doc,
	}
	p.logger.Info("registered openapi target endpoint", "service", serviceName, "base_url", baseURL)
	return nil
}

// ServeHTTP acts as the Multi-Target MCP Reverse Proxy + Security Interceptor.
func (p *MCPProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Step 1: Extract Agent Identity
	agentID, agentKind, err := p.extractIdentity(r)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"unauthorized: %v"}`, err), http.StatusUnauthorized)
		return
	}

	// Step 2: Check if target is a virtualized OpenAPI endpoint
	serviceName := p.extractServiceName(r.URL.Path)

	p.openAPIMux.RLock()
	openAPITarget, isOpenAPI := p.openAPITargets[serviceName]
	p.openAPIMux.RUnlock()

	// Read body payload
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

	// Parse JSON-RPC envelope
	var rpcReq map[string]any
	if len(bodyBytes) > 0 {
		_ = json.Unmarshal(bodyBytes, &rpcReq)
	}

	method, _ := rpcReq["method"].(string)

	// Track active MCP session in Redis if Mcp-Session-Id header is present
	if sessionID := r.Header.Get("Mcp-Session-Id"); sessionID != "" {
		p.trackSession(r.Context(), sessionID, agentID, agentKind, serviceName)
	}

	// Fetch Agent Instance Profile & Status from Redis/Postgres Store
	allowedTools, agentStatus, _ := p.agentStore.GetAgentPermissions(r.Context(), agentID)
	if agentStatus == "revoked" {
		p.logger.Warn("request blocked by agent status revocation", "agent_id", agentID)
		p.sendErrorResponse(w, r, rpcReq["id"], fmt.Sprintf("agent '%s' is revoked", agentID))
		return
	}

	if isOpenAPI {
		p.handleOpenAPIRequest(w, r, openAPITarget, rpcReq, method, agentID, agentKind, allowedTools)
		return
	}

	// Step 3: Resolve Target Native MCP Server URL
	targetURL := p.resolveTargetURL(r.URL.Path)

	// Handle tools/list for native MCP — Filter discovery schema dynamically!
	if method == "tools/list" && len(allowedTools) > 0 {
		p.handleFilteredToolsList(w, r, targetURL, bodyBytes, allowedTools)
		return
	}

	// Step 4: Governance Pipeline Interception for tools/call
	if method == "tools/call" {
		params, _ := rpcReq["params"].(map[string]any)
		toolName, _ := params["name"].(string)
		args, _ := params["arguments"].(map[string]any)

		var amount float64
		if amt, ok := args["amount"].(float64); ok {
			amount = amt
		} else if amtCents, ok := args["amount_cents"].(float64); ok {
			amount = amtCents / 100.0
		}

		allowed, reason := p.governCall(r.Context(), agentID, agentKind, toolName, amount, allowedTools)

		p.auditor.Log(&audit.Entry{
			AgentID:    agentID,
			Action:     toolName,
			Resource:   targetURL,
			Decision:   map[bool]string{true: "allow", false: "deny"}[allowed],
			SpendDelta: int64(amount * 100),
			Reason:     reason,
		})

		if !allowed {
			p.logger.Warn("mcp tool execution DENIED", "agent_id", agentID, "tool", toolName, "reason", reason)
			p.sendErrorResponse(w, r, rpcReq["id"], reason)
			return
		}

		p.logger.Info("mcp tool execution ALLOWED",
			"agent_id", agentID,
			"tool", toolName,
			"target_url", targetURL,
		)
	}

	// Step 5: Forward to Target MCP Server
	p.proxyToTarget(w, r, targetURL, bodyBytes)
}

// handleOpenAPIRequest handles MCP requests virtualized over OpenAPI REST endpoints.
func (p *MCPProxy) handleOpenAPIRequest(
	w http.ResponseWriter,
	r *http.Request,
	target *OpenAPISpecTarget,
	rpcReq map[string]any,
	method string,
	agentID string,
	agentKind string,
	allowedTools []string,
) {
	reqID := rpcReq["id"]

	switch method {
	case "initialize":
		sessionID := fmt.Sprintf("sess_%d_%s", time.Now().UnixNano(), agentID)
		w.Header().Set("Mcp-Session-Id", sessionID)
		p.trackSession(r.Context(), sessionID, agentID, agentKind, p.extractServiceName(r.URL.Path))

		res := map[string]any{
			"jsonrpc": "2.0",
			"id":      reqID,
			"result": map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "reflex-virtual-openapi-mcp", "version": "1.0.0"},
			},
		}
		p.sendJSONRPCResponse(w, r, res)

	case "notifications/initialized":
		w.WriteHeader(http.StatusOK)

	case "tools/list":
		tools, err := adapter.SpecToMCPTools(target.Doc)
		if err != nil {
			p.sendErrorResponse(w, r, reqID, "failed to build openapi tool schema")
			return
		}

		// Filter tools by agent profile whitelist if configured
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

		var amount float64
		if amt, ok := args["amount"].(float64); ok {
			amount = amt
		} else if amtCents, ok := args["amount_cents"].(float64); ok {
			amount = amtCents / 100.0
		}

		// Run Governance Pipeline
		allowed, reason := p.governCall(r.Context(), agentID, agentKind, toolName, amount, allowedTools)

		p.auditor.Log(&audit.Entry{
			AgentID:    agentID,
			Action:     toolName,
			Resource:   target.BaseURL,
			Decision:   map[bool]string{true: "allow", false: "deny"}[allowed],
			SpendDelta: int64(amount * 100),
			Reason:     reason,
		})

		if !allowed {
			p.logger.Warn("openapi virtual tool execution DENIED", "agent_id", agentID, "tool", toolName, "reason", reason)
			p.sendErrorResponse(w, r, reqID, reason)
			return
		}

		// Build and execute REST HTTP Request against legacy bank endpoint
		restReq, err := adapter.BuildRESTRequest(target.BaseURL, target.Doc, toolName, args)
		if err != nil {
			p.sendErrorResponse(w, r, reqID, fmt.Sprintf("invalid tool arguments: %v", err))
			return
		}
		restReq = restReq.WithContext(r.Context())

		resp, err := p.client.Do(restReq)
		if err != nil {
			p.logger.Error("failed REST request to virtual openapi target", "url", restReq.URL.String(), "error", err)
			p.sendErrorResponse(w, r, reqID, "downstream bank REST API unreachable")
			return
		}

		mcpResult := adapter.RESTResponseToMCPResult(resp)
		res := map[string]any{
			"jsonrpc": "2.0",
			"id":      reqID,
			"result":  mcpResult,
		}
		p.sendJSONRPCResponse(w, r, res)

	default:
		p.sendErrorResponse(w, r, reqID, fmt.Sprintf("method '%s' not supported", method))
	}
}

func (p *MCPProxy) sendJSONRPCResponse(w http.ResponseWriter, r *http.Request, res map[string]any) {
	b, _ := json.Marshal(res)
	if strings.Contains(r.Header.Get("Accept"), "text/event-stream") && !strings.Contains(r.Header.Get("Accept"), "application/json") {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "event: message\ndata: %s\n\n", string(b))
	} else {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write(b)
	}
}

func (p *MCPProxy) extractServiceName(path string) string {
	cleanPath := strings.TrimPrefix(path, "/mcp")
	cleanPath = strings.TrimPrefix(cleanPath, "/")
	parts := strings.Split(cleanPath, "/")
	if len(parts) > 0 {
		return parts[0]
	}
	return ""
}

func (p *MCPProxy) handleFilteredToolsList(w http.ResponseWriter, r *http.Request, targetBaseURL string, bodyBytes []byte, allowedTools []string) {
	targetURL := targetBaseURL
	if !strings.HasSuffix(targetBaseURL, "/mcp") {
		targetURL = strings.TrimSuffix(targetBaseURL, "/") + "/mcp"
	}

	outReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		http.Error(w, "proxy error", http.StatusInternalServerError)
		return
	}
	for k, vv := range r.Header {
		for _, v := range vv {
			outReq.Header.Add(k, v)
		}
	}

	resp, err := p.client.Do(outReq)
	if err != nil {
		http.Error(w, "downstream unreachable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "error reading downstream response", http.StatusInternalServerError)
		return
	}

	// Parse SSE wrapper if present
	rawStr := strings.TrimSpace(string(respBytes))
	isSSE := strings.HasPrefix(rawStr, "event: message")
	rawJSON := respBytes
	if isSSE {
		idx := strings.Index(rawStr, "data: ")
		if idx != -1 {
			rawJSON = []byte(strings.TrimSpace(rawStr[idx+6:]))
		}
	}

	var jsonResp map[string]any
	if err := json.Unmarshal(rawJSON, &jsonResp); err == nil {
		if result, ok := jsonResp["result"].(map[string]any); ok {
			if tools, ok := result["tools"].([]any); ok {
				allowedSet := make(map[string]bool)
				for _, t := range allowedTools {
					allowedSet[t] = true
				}

				filteredTools := []any{}
				for _, tool := range tools {
					if toolMap, ok := tool.(map[string]any); ok {
						name, _ := toolMap["name"].(string)
						if allowedSet[name] {
							filteredTools = append(filteredTools, tool)
						}
					}
				}
				result["tools"] = filteredTools
			}
		}
	}

	filteredBytes, _ := json.Marshal(jsonResp)

	for k, vv := range resp.Header {
		if k == "Content-Length" {
			continue
		}
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}

	if isSSE || strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(resp.StatusCode)
		fmt.Fprintf(w, "event: message\ndata: %s\n\n", string(filteredBytes))
	} else {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		w.Write(filteredBytes)
	}
}

func (p *MCPProxy) sendErrorResponse(w http.ResponseWriter, r *http.Request, reqID any, reason string) {
	errResp := map[string]any{
		"jsonrpc": "2.0",
		"id":      reqID,
		"result": map[string]any{
			"content": []map[string]any{
				{
					"type": "text",
					"text": fmt.Sprintf(`{"allow":false,"reason":"%s"}`, reason),
				},
			},
			"isError": true,
		},
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	errJSON, _ := json.Marshal(errResp)
	if strings.Contains(r.Header.Get("Accept"), "text/event-stream") && !strings.Contains(r.Header.Get("Accept"), "application/json") {
		fmt.Fprintf(w, "event: message\ndata: %s\n\n", string(errJSON))
	} else {
		w.Write(errJSON)
	}
}

func (p *MCPProxy) resolveTargetURL(path string) string {
	cleanPath := strings.TrimPrefix(path, "/mcp")
	cleanPath = strings.TrimPrefix(cleanPath, "/")

	parts := strings.Split(cleanPath, "/")
	if len(parts) > 0 && parts[0] != "" {
		serviceName := parts[0]
		if url, ok := p.targets[serviceName]; ok {
			return url
		}
	}

	if defaultURL, ok := p.targets["default"]; ok {
		return defaultURL
	}
	return "http://localhost:9000"
}

func (p *MCPProxy) governCall(ctx context.Context, agentID, agentKind, toolName string, amount float64, allowedTools []string) (bool, string) {
	// 1. Killswitch
	ksRes, err := p.ks.Check(ctx, agentID)
	if err != nil {
		return false, "internal error: killswitch check failed"
	}
	if ksRes.Killed {
		return false, ksRes.Reason
	}

	// 2. OPA Policy Engine
	decision, err := p.policyEngine.Evaluate(ctx, &authz.Input{
		AgentID:      agentID,
		AgentKind:    agentKind,
		Action:       toolName,
		Amount:       amount,
		AllowedTools: allowedTools,
	})
	if err != nil {
		return false, "internal error: policy evaluation failed"
	}
	if !decision.Allow {
		return false, decision.Reason
	}

	// 3. Spend Cap Limiter
	spendDelta := int64(amount * 100)
	if spendDelta > 0 {
		scopes := []spend.Scope{
			{Key: fmt.Sprintf("spend:agent:%s:%s", agentID, time.Now().UTC().Format("2006010215")), Cap: 500000},
			{Key: fmt.Sprintf("spend:fleet:all:%s", time.Now().UTC().Format("20060102")), Cap: 50000000},
		}

		spendRes, err := p.spendLimiter.Check(ctx, spendDelta, scopes)
		if err != nil {
			return false, "internal error: spend limit check failed"
		}
		if !spendRes.Allowed {
			return false, fmt.Sprintf("spend cap exceeded on scope %s (current: %d)", spendRes.ExceededKey, spendRes.Current)
		}
	}

	return true, decision.Reason
}

func (p *MCPProxy) proxyToTarget(w http.ResponseWriter, r *http.Request, targetBaseURL string, bodyBytes []byte) {
	targetURL := targetBaseURL
	if !strings.HasSuffix(targetBaseURL, "/mcp") {
		targetURL = strings.TrimSuffix(targetBaseURL, "/") + "/mcp"
	}
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	outReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		http.Error(w, "proxy error", http.StatusInternalServerError)
		return
	}

	for k, vv := range r.Header {
		for _, v := range vv {
			outReq.Header.Add(k, v)
		}
	}
	outReq.Header.Set("X-Forwarded-By", "agp-gateway")

	resp, err := p.client.Do(outReq)
	if err != nil {
		p.logger.Error("failed to reach target MCP Server", "target", targetBaseURL, "error", err)
		http.Error(w, fmt.Sprintf("downstream MCP Server (%s) unreachable", targetBaseURL), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func (p *MCPProxy) extractIdentity(r *http.Request) (string, string, error) {
	agentID := r.Header.Get("X-Agent-ID")
	agentKind := r.Header.Get("X-Agent-Kind")
	if agentID != "" {
		if agentKind == "" {
			agentKind = "custom"
		}
		return agentID, agentKind, nil
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		token := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := p.jwtMgr.Validate(token)
		if err == nil {
			return claims.AgentID, claims.AgentKind, nil
		}
	}

	return "", "", fmt.Errorf("missing X-Agent-ID or Authorization header")
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
	p.rdb.Set(ctx, key, string(data), 24*time.Hour)
	metrics.ActiveSessions.Inc()
}
