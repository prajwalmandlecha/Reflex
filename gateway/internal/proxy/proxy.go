// Package proxy forwards authorized requests to downstream bank APIs.
//
// The gateway acts as a forced proxy: agents never talk to the bank directly.
// After the authorization pipeline (killswitch → OPA → spend cap) passes,
// the proxy forwards the request to the real bank API on the agent's behalf.
package proxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Route maps an agent action to a Bank API endpoint.
type Route struct {
	Method string
	Path   string
}

// actionRoutes maps agent action names to downstream Bank API endpoints.
var actionRoutes = map[string]Route{
	"payment.initiate":     {Method: "POST", Path: "/transfer"},
	"trading.execute":      {Method: "POST", Path: "/buy"},
	"account.balance":      {Method: "GET", Path: "/balance"},
	"account.transactions": {Method: "GET", Path: "/transactions"},
}

// Proxy forwards authorized requests to the bank API.
type Proxy struct {
	baseURL string
	client  *http.Client
}

// NewProxy creates a new proxy pointing at the given bank API base URL.
func NewProxy(bankBaseURL string) *Proxy {
	return &Proxy{
		baseURL: bankBaseURL,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Forward sends the request to the Bank API and returns the parsed response.
func (p *Proxy) Forward(action, agentID string, payload map[string]any) (map[string]any, error) {
	route, ok := actionRoutes[action]
	if !ok {
		return nil, fmt.Errorf("no downstream route for action: %s", action)
	}

	url := p.baseURL + route.Path

	var req *http.Request
	var err error

	// Inject agent_id into the payload for traceability
	if payload == nil {
		payload = make(map[string]any)
	}
	payload["agent_id"] = agentID

	if route.Method == "POST" {
		body, _ := json.Marshal(payload)
		req, err = http.NewRequest("POST", url, bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("creating request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
	} else {
		req, err = http.NewRequest("GET", url, nil)
		if err != nil {
			return nil, fmt.Errorf("creating request: %w", err)
		}
		// For GET requests, add agent_id as query param
		q := req.URL.Query()
		q.Set("agent_id", agentID)
		req.URL.RawQuery = q.Encode()
	}

	// Add a tracing header so the bank API knows which gateway instance forwarded this
	req.Header.Set("X-Forwarded-By", "agp-gateway")
	req.Header.Set("X-Agent-ID", agentID)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("bank API unreachable: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading bank API response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("bank API returned status %d: %s", resp.StatusCode, string(respBytes))
	}

	var result map[string]any
	if err := json.Unmarshal(respBytes, &result); err != nil {
		return nil, fmt.Errorf("parsing bank API response: %w", err)
	}

	return result, nil
}

// HasRoute checks if a given action has a downstream bank API route.
func HasRoute(action string) bool {
	_, ok := actionRoutes[action]
	return ok
}
