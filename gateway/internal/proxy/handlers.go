package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/agp/gateway/internal/adapter"
	"github.com/agp/gateway/internal/configcache"
	"github.com/agp/gateway/internal/metrics"
)

// sourcedEntry pairs an item (tool, resource, prompt) with the connection that
// advertised it, so dedupe can prefer the entry that routing will actually
// serve.
type sourcedEntry struct {
	connID string
	item   map[string]any
}

// fanoutFailure records one downstream connection that failed or timed out
// during an aggregated list fan-out.
type fanoutFailure struct {
	connID string
	method string
	err    error
}

// fanoutFailureReason classifies a fan-out error for human-facing surfaces.
func fanoutFailureReason(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "timed out"
	}
	return err.Error()
}

// reportFanoutFailures makes silent partial results visible: it logs a
// warning, bumps a Prometheus counter, and publishes a connection_degraded
// event so the Control Center activity stream shows that a connection was
// dropped from an aggregated list — instead of the agent mistaking the gap
// for "connection has 0 tools". Returns the failed connection IDs so callers
// can attach them to the response's _meta extension point.
func (p *MCPProxy) reportFanoutFailures(ctx context.Context, fails []fanoutFailure) []string {
	if len(fails) == 0 {
		return nil
	}
	conns := make([]string, 0, len(fails))
	reasons := make([]string, 0, len(fails))
	for _, f := range fails {
		conns = append(conns, f.connID)
		reasons = append(reasons, fmt.Sprintf("%s: %s", f.connID, fanoutFailureReason(f.err)))
		p.logger.Warn("aggregated fan-out dropped a downstream target",
			"connection", f.connID, "method", f.method, "error", f.err)
		metrics.FanoutFailures.WithLabelValues(f.connID, f.method).Inc()
	}
	p.publishEvent(ctx, GovernanceEvent{
		Type:      "connection_degraded",
		Decision:  "warn",
		DenyStage: "downstream",
		Tool:      fails[0].method,
		Reason:    fmt.Sprintf("%s fan-out dropped connections: %s", fails[0].method, strings.Join(reasons, "; ")),
		Latency:   map[string]float64{},
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
	})
	return conns
}

// pickRoutedWinner decides which duplicate entry survives dedupe. The routing
// map is authoritative: if it names one of the two connections, that
// connection's entry wins, so the schema the agent sees is the one the
// follow-up call/read will actually execute against. If neither (or both)
// match — e.g. the name is unrouted — the lower connection ID wins
// deterministically, instead of the outcome depending on goroutine completion
// order.
func pickRoutedWinner(routed string, a, b sourcedEntry) sourcedEntry {
	aMatch := routed != "" && a.connID == routed
	bMatch := routed != "" && b.connID == routed
	switch {
	case aMatch && !bMatch:
		return a
	case bMatch && !aMatch:
		return b
	default:
		if a.connID <= b.connID {
			return a
		}
		return b
	}
}

// supportedProtocolVersions are the MCP protocol revisions this gateway is
// tested against. Negotiation per the MCP spec: if the client requests a
// version we support, echo it; otherwise respond with OUR latest supported
// version and let the client decide whether to continue or disconnect — never
// blindly echo an untested version and claim compatibility with it.
var supportedProtocolVersions = []string{"2025-06-18", "2025-03-26"}

// negotiateProtocolVersion picks the protocol version to advertise in an
// initialize response. Returns the client's version when supported, otherwise
// the newest version this gateway implements.
func negotiateProtocolVersion(requested string) string {
	for _, v := range supportedProtocolVersions {
		if requested == v {
			return requested
		}
	}
	return supportedProtocolVersions[0]
}

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

		// Negotiate per the MCP spec: echo the client's version only when we
		// actually support it, otherwise respond with our latest supported
		// version. Echoing an untested version claims compatibility we don't
		// have — the client would then build behavior against spec features
		// this gateway never implemented.
		clientProtocol := "2025-06-18"
		if params, ok := rpcReq["params"].(map[string]any); ok {
			if pv, ok := params["protocolVersion"].(string); ok && pv != "" {
				clientProtocol = pv
			}
		}
		clientProtocol = negotiateProtocolVersion(clientProtocol)

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

	case "ping":
		res := map[string]any{
			"jsonrpc": "2.0",
			"id":      reqID,
			"result":  map[string]any{},
		}
		p.sendJSONRPCResponse(w, r, res)

	case "notifications/initialized", "notifications/cancelled":
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

		allowed, denyStage, reason, timings, committedEntries := p.governCall(r.Context(), callKindTool, agentID, classID, agentKind, toolName, allowedTools, agentCfg, args)

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
				// Fallback to incoming HTTP request Idempotency-Key if not set via args
				if restReq.Header.Get("Idempotency-Key") == "" {
					if idem := r.Header.Get("Idempotency-Key"); idem != "" {
						restReq.Header.Set("Idempotency-Key", idem)
					} else if idem := r.Header.Get("X-Idempotency-Key"); idem != "" {
						restReq.Header.Set("Idempotency-Key", idem)
					}
				}
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

	var allTools []sourcedEntry
	var rpcReq map[string]any
	if err := json.Unmarshal(bodyBytes, &rpcReq); err != nil {
		// Malformed body: answer with a proper JSON-RPC parse error (-32700)
		// instead of a result envelope with "id": null.
		p.sendJSONRPCError(w, r, nil, -32700, "Parse error")
		return
	}
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
	var fails []fanoutFailure
	for _, job := range jobs {
		wg.Add(1)
		go func(svcName, targetURL string) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			reqWithTimeout := r.WithContext(ctx)
			tools, err := p.fetchToolsFromTarget(reqWithTimeout, svcName, targetURL, bodyBytes)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				fails = append(fails, fanoutFailure{connID: svcName, method: "tools/list", err: err})
				return
			}
			for _, t := range tools {
				if tm, ok := t.(map[string]any); ok {
					allTools = append(allTools, sourcedEntry{connID: svcName, item: tm})
				}
			}
		}(job.svcName, job.url)
	}
	wg.Wait()
	failedConns := p.reportFanoutFailures(r.Context(), fails)

	// 2. Fetch from OpenAPI virtual targets
	p.openAPIMux.RLock()
	for id, target := range p.openAPITargets {
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
			allTools = append(allTools, sourcedEntry{connID: id, item: toolMap})
		}
	}
	p.openAPIMux.RUnlock()

	// 3. Dedupe by tool NAME (not URL): two connections can expose the same
	// tool name, but tools/call routing resolves a name to exactly one
	// connection (agp:tool_routing, last-write-wins). The dedupe winner is
	// chosen by the SAME mechanism: the routing map's owner wins, so the
	// schema the agent sees is the one the call will execute against. When the
	// name is unrouted (or the routed connection didn't answer the fan-out),
	// the lowest connection ID wins deterministically — never goroutine
	// completion order.
	seenNames := make(map[string]sourcedEntry)
	for _, entry := range allTools {
		name, _ := entry.item["name"].(string)
		if name == "" {
			continue
		}
		if prev, dup := seenNames[name]; dup {
			seenNames[name] = pickRoutedWinner(p.resolveServiceForTool(name), prev, entry)
		} else {
			seenNames[name] = entry
		}
	}

	// 4. Filter by allowed tools
	var filtered []any
	for _, entry := range seenNames {
		name, _ := entry.item["name"].(string)
		if len(allowedTools) == 0 || allowedSet[name] {
			filtered = append(filtered, entry.item)
		}
	}
	sort.Slice(filtered, func(i, j int) bool {
		a, _ := filtered[i].(map[string]any)["name"].(string)
		b, _ := filtered[j].(map[string]any)["name"].(string)
		return a < b
	})
	if filtered == nil {
		filtered = []any{}
	}

	result := map[string]any{"tools": filtered}
	if len(failedConns) > 0 {
		// MCP _meta extension point: a machine-readable signal that the list is
		// INCOMPLETE, so an agent can distinguish "connection has 0 tools" from
		// "connection timed out".
		result["_meta"] = map[string]any{
			"reflex.gateway/incomplete": true,
			"failed_connections":        failedConns,
		}
	}

	res := map[string]any{
		"jsonrpc": "2.0",
		"id":      reqID,
		"result":  result,
	}
	p.sendJSONRPCResponse(w, r, res)
}

// handleAggregatedList fans a resources/list or prompts/list request out to all
// native MCP targets, merges the results, dedupes by uri/name, and returns the
// merged list. (OpenAPI virtual targets don't expose MCP resources/prompts, so
// only native targets are queried.)
//
// Note: there is deliberately NO filtering by the agent's tool whitelist here —
// that list only governs tools/call. Exposure of prompts/resources is
// controlled by the per-item "exposed" flag set during discovery, so everything
// the downstream advertises is surfaced.
func (p *MCPProxy) handleAggregatedList(w http.ResponseWriter, r *http.Request, bodyBytes []byte, method string) {
	// Lazy self-heal, same as handleAggregatedToolsList: re-read the connection
	// cache and routing maps on every request. Without this, the startup race
	// where the gateway loads 0 native targets before the pub/sub landed makes
	// resources/list and prompts/list return empty FOREVER — the exact bug the
	// tools fan-out already fixed. One Redis GET per request is negligible
	// next to the downstream fan-out.
	p.LoadNativeTargets(r.Context())
	p.LoadToolRouting(r.Context())
	p.LoadPromptRouting(r.Context())
	p.LoadResourceRouting(r.Context())

	var rpcReq map[string]any
	if err := json.Unmarshal(bodyBytes, &rpcReq); err != nil {
		p.sendJSONRPCError(w, r, nil, -32700, "Parse error")
		return
	}
	reqID := rpcReq["id"]

	// result key is "resources" for resources/list, "prompts" for prompts/list
	resultKey := "resources"
	idField := "uri"
	if method == "prompts/list" {
		resultKey = "prompts"
		idField = "name"
	}

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
	var fails []fanoutFailure
	seen := make(map[string]sourcedEntry)
	for _, job := range jobs {
		wg.Add(1)
		go func(svcName, targetURL string) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			reqWithTimeout := r.WithContext(ctx)
			items, err := p.fetchListFromTarget(reqWithTimeout, svcName, targetURL, bodyBytes, resultKey)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				fails = append(fails, fanoutFailure{connID: svcName, method: method, err: err})
				return
			}
			for _, item := range items {
				if m, ok := item.(map[string]any); ok {
					id, _ := m[idField].(string)
					if id == "" {
						continue
					}
					// Prompts and resources are NOT governed by the agent's
					// tool whitelist — that list only gates tools/call.
					// Exposure of prompts/resources is controlled by the
					// per-item "exposed" flag set during discovery, so we
					// surface everything the downstream advertises.
					if prev, dup := seen[id]; dup {
						// Same routing-aligned dedupe as tools: the routing
						// map's owner wins so the URI/name the agent sees is
						// the one a follow-up read/get will actually serve.
						var routed string
						if resultKey == "resources" {
							routed = p.resolveServiceForResource(id)
						} else {
							routed = p.resolveServiceForPrompt(id)
						}
						seen[id] = pickRoutedWinner(routed, prev, sourcedEntry{connID: svcName, item: m})
					} else {
						seen[id] = sourcedEntry{connID: svcName, item: m}
					}
				}
			}
		}(job.svcName, job.url)
	}
	wg.Wait()
	failedConns := p.reportFanoutFailures(r.Context(), fails)

	// Deterministic output order (map iteration is randomized in Go).
	merged := make([]any, 0, len(seen))
	for _, entry := range seen {
		merged = append(merged, entry.item)
	}
	sort.Slice(merged, func(i, j int) bool {
		a, _ := merged[i].(map[string]any)[idField].(string)
		b, _ := merged[j].(map[string]any)[idField].(string)
		return a < b
	})

	result := map[string]any{resultKey: merged}
	if len(failedConns) > 0 {
		result["_meta"] = map[string]any{
			"reflex.gateway/incomplete": true,
			"failed_connections":        failedConns,
		}
	}

	res := map[string]any{
		"jsonrpc": "2.0",
		"id":      reqID,
		"result":  result,
	}
	p.sendJSONRPCResponse(w, r, res)
}

// fetchListFromTarget forwards a resources/list or prompts/list to a single
// native MCP downstream and returns the items array. Returns a non-nil error
// when the target failed or timed out, so aggregated fan-outs can surface the
// gap instead of silently dropping the connection.
func (p *MCPProxy) fetchListFromTarget(r *http.Request, connID, targetURL string, bodyBytes []byte, resultKey string) ([]any, error) {
	outReq, err := http.NewRequestWithContext(r.Context(), "POST", targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	outReq.Header.Set("Content-Type", "application/json")
	outReq.Header.Set("Accept", "application/json, text/event-stream")
	if sessID := p.getOrCreateDownstreamSession(r.Context(), connID, targetURL); sessID != "" {
		outReq.Header.Set("Mcp-Session-Id", sessID)
	}

	resp, err := p.client.Do(outReq)
	if err != nil {
		return nil, fmt.Errorf("downstream unreachable: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
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
		return nil, fmt.Errorf("malformed downstream response (HTTP %d)", resp.StatusCode)
	}
	result, _ := rpcResp["result"].(map[string]any)
	items, _ := result[resultKey].([]any)
	return items, nil
}
