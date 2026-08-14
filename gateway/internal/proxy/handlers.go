package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/agp/gateway/internal/adapter"
	"github.com/agp/gateway/internal/configcache"
)

// handleOpenAPIRequest dispatches MCP JSON-RPC methods for connections backed
// by an OpenAPI spec, translating tools/call into REST requests and handling
// initialize, tools/list, and notifications locally.
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

		// Stateless protocol 2025-06-18; echo back the client's requested version.
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
				p.rollbackCommittedEntries(committedEntries, agentID, toolName)
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
					p.rollbackCommittedEntries(committedEntries, agentID, toolName)
					allowed = false
					denyStage = "downstream"
					reason = "downstream bank REST API unreachable"
					p.sendErrorResponse(w, r, reqID, reason)
				} else if resp.StatusCode >= 500 {
					// Downstream 5xx after governance committed: refund budget.
					// 4xx is a legitimate (if rejected) bank response and stays charged.
					resp.Body.Close()
					p.rollbackCommittedEntries(committedEntries, agentID, toolName)
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

		// Denied requests must not contribute to spend totals
		spendDeltaCents := int64(0)
		if allowed {
			spendDeltaCents = int64(amount * 100)
		}

		if allowed {
			res := map[string]any{"jsonrpc": "2.0", "id": reqID, "result": mcpResult}
			p.sendJSONRPCResponse(w, r, res)
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
			responseData: mcpResult,
		})

	default:
		p.sendErrorResponse(w, r, reqID, fmt.Sprintf("method '%s' not supported", method))
	}
}

// handleAggregatedToolsList fetches tools/list from all registered services
// (native MCP targets + OpenAPI virtual targets), merges them, filters by the
// agent's allowed tools, and returns a single combined response.
func (p *MCPProxy) handleAggregatedToolsList(w http.ResponseWriter, r *http.Request, bodyBytes []byte, allowedTools []string) {
	// Lazy self-heal: re-read the connection cache and tool routing from Redis
	// on every tools/list. This closes the startup race where the gateway loads
	// 0 native MCP targets (or a stale routing map) and never refreshes until a
	// config:updates pub/sub message arrives. Cost is one Redis GET per request,
	// which is negligible compared to the downstream tools/list fan-out below.
	p.LoadNativeTargets(r.Context())
	p.LoadToolRouting(r.Context())
	p.LoadPromptRouting(r.Context())
	p.LoadResourceRouting(r.Context())

	allowedSet := make(map[string]bool)
	for _, t := range allowedTools {
		allowedSet[t] = true
	}

	var allTools []any
	var rpcReq map[string]any
	_ = json.Unmarshal(bodyBytes, &rpcReq)
	reqID := rpcReq["id"]

	// 1. Fetch from native MCP targets concurrently (fast 2s timeout per target)
	type targetJob struct {
		svcName string
		url     string
	}
	var jobs []targetJob
	seen := make(map[string]bool)
	p.rangeTargets(func(svcName, targetBaseURL string) {
		if svcName == "default" {
			return
		}
		// mcp_url is the complete MCP endpoint — use verbatim, no /mcp suffix.
		targetURL := targetBaseURL
		if seen[targetURL] {
			return
		}
		seen[targetURL] = true
		jobs = append(jobs, targetJob{svcName: svcName, url: targetURL})
	})

	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, job := range jobs {
		wg.Add(1)
		go func(targetURL string) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			reqWithTimeout := r.WithContext(ctx)
			tools := p.fetchToolsFromTarget(reqWithTimeout, targetURL, bodyBytes)
			if len(tools) > 0 {
				mu.Lock()
				allTools = append(allTools, tools...)
				mu.Unlock()
			}
		}(job.url)
	}
	wg.Wait()

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

// handleAggregatedList fans a resources/list or prompts/list request out to all
// native MCP targets, merges the results, dedupes by uri/name, and filters by
// the agent's allowed list. (OpenAPI virtual targets don't expose MCP
// resources/prompts, so only native targets are queried.)
func (p *MCPProxy) handleAggregatedList(w http.ResponseWriter, r *http.Request, bodyBytes []byte, method string, _ []string) {
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
	type listJob struct {
		svcName string
		url     string
	}
	var jobs []listJob
	seenURL := make(map[string]bool)
	p.rangeTargets(func(svcName, targetBaseURL string) {
		if svcName == "default" {
			return
		}
		// mcp_url is the complete MCP endpoint — use verbatim, no /mcp suffix.
		targetURL := targetBaseURL
		if seenURL[targetURL] {
			return
		}
		seenURL[targetURL] = true
		jobs = append(jobs, listJob{svcName: svcName, url: targetURL})
	})

	var wg sync.WaitGroup
	var mu sync.Mutex
	seen := make(map[string]bool)
	for _, job := range jobs {
		wg.Add(1)
		go func(targetURL string) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			reqWithTimeout := r.WithContext(ctx)
			items := p.fetchListFromTarget(reqWithTimeout, targetURL, bodyBytes, resultKey)
			if len(items) > 0 {
				mu.Lock()
				for _, item := range items {
					if m, ok := item.(map[string]any); ok {
						id, _ := m[idField].(string)
						if id == "" || seen[id] {
							continue
						}
						seen[id] = true
						// Prompts and resources are NOT governed by the agent's
						// tool whitelist — that list only gates tools/call.
						// Exposure of prompts/resources is controlled by the
						// per-item "exposed" flag set during discovery, so we
						// surface everything the downstream advertises.
						merged = append(merged, item)
					}
				}
				mu.Unlock()
			}
		}(job.url)
	}
	wg.Wait()
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
