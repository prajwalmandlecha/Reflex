package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// proxyToTarget forwards the request downstream and writes the response.
// Returns false when the downstream exchange failed (unreachable, read error,
// or 5xx) so callers can roll back any governance counters committed in
// governCall — a failed downstream call must not consume budget.
func (p *MCPProxy) proxyToTarget(w http.ResponseWriter, r *http.Request, targetBaseURL string, bodyBytes []byte, serviceName ...string) bool {
	// mcp_url is stored as the complete MCP endpoint (e.g. https://mcp.exa.ai/mcp
	// or https://mockhero.dev/mcp/agent). Use it verbatim — do NOT append /mcp,
	// which corrupts endpoints that already include a path segment.
	targetURL := targetBaseURL
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

// --- Downstream Session Management ---

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
			"protocolVersion": "2025-06-18",
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

	// Stateless servers may not return a session; only cache it if present.
	sessID := resp.Header.Get("Mcp-Session-Id")
	if sessID != "" && p.rdb != nil {
		key := fmt.Sprintf("mcp:auto_session:%s", targetURL)
		p.rdb.Set(ctx, key, sessID, 1*time.Hour)
	}

	return sessID
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
			"protocolVersion": "2025-06-18",
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

	// Stateless servers may not return a session; only cache it if present.
	sessID := resp.Header.Get("Mcp-Session-Id")
	if sessID != "" && p.rdb != nil {
		key := fmt.Sprintf("mcp:auto_session:%s", targetURL)
		p.rdb.Set(ctx, key, sessID, 1*time.Hour)
	}
	return sessID
}
