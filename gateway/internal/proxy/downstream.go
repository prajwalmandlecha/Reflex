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

// extractRequestID pulls the JSON-RPC "id" field out of a request body so
// downstream-failure error responses can echo it back and stay correlated with
// the agent's request. Returns nil when the body isn't valid JSON-RPC.
func extractRequestID(bodyBytes []byte) any {
	var rpcReq map[string]any
	if err := json.Unmarshal(bodyBytes, &rpcReq); err != nil {
		return nil
	}
	return rpcReq["id"]
}

// proxyToTarget forwards the request downstream and writes the response.
// Returns (false, nil) when the downstream exchange failed (unreachable, read
// error, or 5xx) so callers can roll back any governance counters committed in
// governCall — a failed downstream call must not consume budget. On success it
// returns (true, respBytes) so callers can surface the real downstream response
// in the live governance event stream.
func (p *MCPProxy) proxyToTarget(w http.ResponseWriter, r *http.Request, targetBaseURL string, bodyBytes []byte, serviceName ...string) (bool, []byte) {
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

	// Preserve the JSON-RPC request id so downstream-failure error responses
	// stay correlated with the agent's request (previously id was nil).
	reqID := extractRequestID(bodyBytes)

	resp := p.doProxyRequest(r, targetURL, bodyBytes, false, connID)
	if resp == nil {
		p.logger.Error("failed to reach target MCP Server", "target", targetBaseURL)
		p.sendErrorResponse(w, r, reqID, fmt.Sprintf("downstream MCP Server (%s) unreachable", targetBaseURL))
		return false, nil
	}
	defer resp.Body.Close()

	// Read a bounded prefix to detect "Session has been terminated" so we can
	// transparently retry with a fresh session BEFORE streaming anything to the
	// client. The termination error is short and appears at the start of the
	// body, so a small prefix is sufficient.
	const sessionProbe = 64 * 1024
	prefix, err := io.ReadAll(io.LimitReader(resp.Body, sessionProbe))
	if err != nil {
		p.sendErrorResponse(w, r, reqID, "error reading downstream response")
		return false, nil
	}

	// Detect "Session has been terminated" and retry with a fresh session
	if strings.Contains(string(prefix), "Session has been terminated") {
		p.logger.Info("downstream session terminated, re-initializing", "target", targetURL)
		p.invalidateDownstreamSession(r.Context(), connID, targetURL)
		resp.Body.Close()

		resp2 := p.doProxyRequest(r, targetURL, bodyBytes, true, connID)
		if resp2 == nil {
			p.sendErrorResponse(w, r, reqID, fmt.Sprintf("downstream MCP Server (%s) unreachable", targetBaseURL))
			return false, nil
		}
		defer resp2.Body.Close()
		respBytes, err := io.ReadAll(resp2.Body)
		if err != nil {
			p.sendErrorResponse(w, r, reqID, "error reading downstream response")
			return false, nil
		}
		for k, vv := range resp2.Header {
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp2.StatusCode)
		w.Write(respBytes)
		return resp2.StatusCode < 500, respBytes
	}

	// Stream the response to the client while capturing the full body for the
	// live governance event stream. A TeeReader forwards bytes as they arrive
	// (no full buffering of large SSE responses) while a buffer accumulates the
	// same bytes for parseResponseData.
	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)

	var captured bytes.Buffer
	captured.Write(prefix)
	if _, err := w.Write(prefix); err != nil {
		return false, nil
	}
	_, err = io.Copy(io.MultiWriter(w, &captured), resp.Body)
	if err != nil {
		p.logger.Warn("error streaming downstream response", "target", targetURL, "error", err)
		return false, nil
	}
	return resp.StatusCode < 500, captured.Bytes()
}

// parseResponseData converts a raw downstream response body into a structured
// value for the live governance event stream. It prefers the MCP result payload
// (result.content[].text) so the Control Center shows the real tool output, and
// falls back to the raw body when it isn't valid JSON.
func (p *MCPProxy) parseResponseData(respBytes []byte) any {
	if len(respBytes) == 0 {
		return nil
	}
	var envelope map[string]any
	if err := json.Unmarshal(respBytes, &envelope); err != nil {
		return string(respBytes)
	}
	// MCP JSON-RPC response: prefer the result payload.
	if result, ok := envelope["result"].(map[string]any); ok {
		if content, ok := result["content"].([]any); ok && len(content) > 0 {
			if first, ok := content[0].(map[string]any); ok {
				if text, ok := first["text"].(string); ok && text != "" {
					// The text is often itself a JSON string — try to parse it.
					var inner any
					if err := json.Unmarshal([]byte(text), &inner); err == nil {
						return inner
					}
					return text
				}
			}
		}
		return result
	}
	// JSON-RPC error envelope.
	if errObj, ok := envelope["error"].(map[string]any); ok {
		return errObj
	}
	return envelope
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
		if sessID := p.createDownstreamSession(r.Context(), connID, targetURL); sessID != "" {
			outReq.Header.Set("Mcp-Session-Id", sessID)
		}
	} else if sessID := p.getOrCreateDownstreamSession(r.Context(), connID, targetURL); sessID != "" {
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
func (p *MCPProxy) fetchToolsFromTarget(r *http.Request, connID, targetURL string, bodyBytes []byte) []any {
	tools, terminated := p.doFetchTools(r, connID, targetURL, bodyBytes, false)
	if terminated {
		p.logger.Info("downstream session terminated during tools/list, re-initializing", "target", targetURL)
		p.invalidateDownstreamSession(r.Context(), connID, targetURL)
		tools, _ = p.doFetchTools(r, connID, targetURL, bodyBytes, true)
	}
	return tools
}

func (p *MCPProxy) doFetchTools(r *http.Request, connID, targetURL string, bodyBytes []byte, forceNewSession bool) ([]any, bool) {
	outReq, err := http.NewRequestWithContext(r.Context(), "POST", targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, false
	}
	outReq.Header.Set("Content-Type", "application/json")
	outReq.Header.Set("Accept", "application/json, text/event-stream")

	if forceNewSession {
		if sessID := p.createDownstreamSession(r.Context(), connID, targetURL); sessID != "" {
			outReq.Header.Set("Mcp-Session-Id", sessID)
		}
	} else if sessID := p.getOrCreateDownstreamSession(r.Context(), connID, targetURL); sessID != "" {
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

// sessionKey builds the Redis key for a downstream session. The connection ID
// is included so two connections pointing at the SAME MCP URL but with
// DIFFERENT credentials don't share a session (a session is scoped to the
// authenticated downstream identity, not just the URL).
func sessionKey(connID, targetURL string) string {
	if connID != "" {
		return fmt.Sprintf("mcp:auto_session:%s:%s", connID, targetURL)
	}
	return fmt.Sprintf("mcp:auto_session:%s", targetURL)
}

func (p *MCPProxy) getOrCreateDownstreamSession(ctx context.Context, connID, targetURL string) string {
	if p.rdb != nil {
		key := sessionKey(connID, targetURL)
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
		key := sessionKey(connID, targetURL)
		p.rdb.Set(ctx, key, sessID, 1*time.Hour)
	}

	return sessID
}

// invalidateDownstreamSession removes the cached session for a target.
func (p *MCPProxy) invalidateDownstreamSession(ctx context.Context, connID, targetURL string) {
	if p.rdb != nil {
		key := sessionKey(connID, targetURL)
		p.rdb.Del(ctx, key)
	}
}

// createDownstreamSession initializes a new session with the downstream and caches it.
func (p *MCPProxy) createDownstreamSession(ctx context.Context, connID, targetURL string) string {
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
		key := sessionKey(connID, targetURL)
		p.rdb.Set(ctx, key, sessID, 1*time.Hour)
	}
	return sessID
}
