package proxy

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/agp/gateway/internal/metrics"
)

// sendJSONRPCResponse writes a JSON-RPC result as either SSE or plain JSON,
// depending on the client's Accept header preference.
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

// sendErrorResponse writes a governance-denied MCP result (isError: true) as
// either SSE or plain JSON.
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

// extractIdentity authenticates the caller. A valid Bearer JWT is REQUIRED;
// identity is derived solely from the validated token claims.
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

	return claims.AgentID, claims.AgentKind, nil
}

// trackSession registers or refreshes an MCP session in Redis and increments
// the ActiveSessions gauge only for genuinely new sessions.
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

// publishEvent sends a governance event to Redis pub/sub for frontend WebSocket
// streaming.
func (p *MCPProxy) publishEvent(ctx context.Context, event GovernanceEvent) {
	data, err := json.Marshal(event)
	if err == nil {
		p.rdb.Publish(ctx, "gateway:events", string(data))
	}
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

// defaultSensitiveKeys are the well-known field names whose values must never
// be persisted to the audit log or published to the event stream. This covers
// credentials/tokens AND banking PII (account numbers, routing numbers, card
// data, personal identifiers). Matching is case-insensitive and recursive, so a
// nested field like transactions[].account_number is caught too.
var defaultSensitiveKeys = map[string]bool{
	// Credentials / tokens / secrets
	"bearer_token":  true,
	"token":         true,
	"access_token":  true,
	"refresh_token": true,
	"password":      true,
	"passwd":        true,
	"secret":        true,
	"api_key":       true,
	"apikey":        true,
	"authorization": true,
	"private_key":   true,
	"client_secret": true,
	"credential":    true,
	"credentials":   true,
	// Banking / payment identifiers
	"account_number": true,
	"account_num":    true,
	"account_no":     true,
	"routing_number": true,
	"routing_num":    true,
	"card_number":    true,
	"card_num":       true,
	"cvv":            true,
	"cvc":            true,
	"pin":            true,
	"iban":           true,
	"bic":            true,
	"swift":          true,
	"swift_code":     true,
	// Personal identifiers (PII)
	"ssn":             true,
	"social_security": true,
	"tax_id":          true,
	"tin":             true,
	"date_of_birth":   true,
	"dob":             true,
	"email":           true,
	"phone":           true,
	"phone_number":    true,
	"address":         true,
	"customer_name":   true,
	"full_name":       true,
}

// redactValue returns a deep copy of v with any field whose (lowercased) key is
// in the sensitive set replaced by "[REDACTED]". It recurses through maps and
// slices so nested PII is caught, not just top-level keys. Non-map/slice values
// are returned unchanged.
func redactValue(v any, sensitive map[string]bool) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			if sensitive[strings.ToLower(k)] {
				out[k] = "[REDACTED]"
			} else {
				out[k] = redactValue(val, sensitive)
			}
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = redactValue(val, sensitive)
		}
		return out
	default:
		return v
	}
}

// ms converts a time.Duration to milliseconds with microsecond precision.
func ms(d time.Duration) float64 {
	return float64(d.Microseconds()) / 1000.0
}
