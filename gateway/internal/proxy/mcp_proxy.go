// Package proxy implements an in-flight MCP Security Interceptor & Proxy with multi-server routing,
// Agent Profile/ABAC tool whitelisting, and dynamic tools/list discovery filtering.
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
	"time"

	"github.com/agp/gateway/internal/agent"
	"github.com/agp/gateway/internal/audit"
	"github.com/agp/gateway/internal/authn"
	"github.com/agp/gateway/internal/authz"
	"github.com/agp/gateway/internal/killswitch"
	"github.com/agp/gateway/internal/spend"
)

type MCPProxy struct {
	targets      map[string]string
	ks           *killswitch.Switch
	policyEngine *authz.Engine
	spendLimiter *spend.Limiter
	auditor      *audit.Logger
	jwtMgr       *authn.JWTManager
	agentStore   *agent.Store
	logger       *slog.Logger
	client       *http.Client
}

func NewMCPProxy(
	targets map[string]string,
	ks *killswitch.Switch,
	policyEngine *authz.Engine,
	spendLimiter *spend.Limiter,
	auditor *audit.Logger,
	jwtMgr *authn.JWTManager,
	agentStore *agent.Store,
	logger *slog.Logger,
) *MCPProxy {
	return &MCPProxy{
		targets:      targets,
		ks:           ks,
		policyEngine: policyEngine,
		spendLimiter: spendLimiter,
		auditor:      auditor,
		jwtMgr:       jwtMgr,
		agentStore:   agentStore,
		logger:       logger,
		client:       &http.Client{Timeout: 15 * time.Second},
	}
}

// ServeHTTP acts as the Multi-Target MCP Reverse Proxy + Security Interceptor.
func (p *MCPProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Step 1: Extract Agent Identity
	agentID, agentKind, err := p.extractIdentity(r)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"unauthorized: %v"}`, err), http.StatusUnauthorized)
		return
	}

	// Step 2: Resolve Target MCP Server URL
	targetURL := p.resolveTargetURL(r.URL.Path)

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

	// Fetch Agent Instance Profile & Status from Redis/Postgres Store
	allowedTools, agentStatus, _ := p.agentStore.GetAgentPermissions(r.Context(), agentID)
	if agentStatus == "revoked" {
		p.logger.Warn("request blocked by agent status revocation", "agent_id", agentID)
		p.sendErrorResponse(w, r, rpcReq["id"], fmt.Sprintf("agent '%s' is revoked", agentID))
		return
	}

	// Step 3: Handle tools/list — Filter discovery schema dynamically!
	if method == "tools/list" && len(allowedTools) > 0 {
		p.handleFilteredToolsList(w, r, targetURL, bodyBytes, allowedTools)
		return
	}

	// Step 4: Handle tools/call — Intercept and Govern!
	if method == "tools/call" {
		params, _ := rpcReq["params"].(map[string]any)
		toolName, _ := params["name"].(string)
		arguments, _ := params["arguments"].(map[string]any)

		var amount float64
		if amt, ok := arguments["amount"].(float64); ok {
			amount = amt
		} else if amtCents, ok := arguments["amount_cents"].(float64); ok {
			amount = amtCents / 100.0
		}

		reqID := rpcReq["id"]

		// Run 4-Step Authorization Gauntlet
		start := time.Now()
		allow, reason := p.governCall(r.Context(), agentID, agentKind, toolName, amount, allowedTools)

		// Emit Audit Entry
		spendDelta := int64(amount * 100)
		decisionStr := "deny"
		if allow {
			decisionStr = "allow"
		}
		p.auditor.Log(&audit.Entry{
			AgentID:    agentID,
			Action:     toolName,
			Resource:   "",
			Decision:   decisionStr,
			SpendDelta: spendDelta,
			LatencyMs:  float64(time.Since(start).Microseconds()) / 1000.0,
			Reason:     reason,
		})

		// IF DENIED: Short-circuit!
		if !allow {
			p.logger.Warn("MCP tool call DENIED by Gateway",
				"agent_id", agentID,
				"tool", toolName,
				"reason", reason,
				"target_url", targetURL,
			)
			p.sendErrorResponse(w, r, reqID, reason)
			return
		}

		p.logger.Info("MCP tool call ALLOWED by Gateway — forwarding to target MCP Server",
			"agent_id", agentID,
			"tool", toolName,
			"target_url", targetURL,
		)
	}

	// Step 5: Forward to Target MCP Server
	p.proxyToTarget(w, r, targetURL, bodyBytes)
}

// handleFilteredToolsList proxies tools/list to target, then filters the tool schema by allowedTools.
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
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)

	if strings.Contains(r.Header.Get("Accept"), "text/event-stream") && !strings.Contains(r.Header.Get("Accept"), "application/json") {
		fmt.Fprintf(w, "event: message\ndata: %s\n\n", string(filteredBytes))
	} else {
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
