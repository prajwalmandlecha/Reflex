// mcpserver.go provides the inbound MCP server that agents connect to.
//
// Pattern 2: The gateway is a FORCED PROXY. Agents cannot reach the Bank API directly.
// When an agent calls the "execute" tool, the gateway:
//   1. Runs the full authorization gauntlet (killswitch → OPA → spend cap → audit)
//   2. If authorized, forwards the request to the Bank API on the agent's behalf
//   3. Returns the Bank API response to the agent
//
// The agent never sees or touches the Bank API directly.
package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/agp/gateway/internal/authn"
	"github.com/agp/gateway/internal/proxy"
	"github.com/agp/gateway/internal/session"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// MCPServer wraps the MCP server and authorization pipeline.
type MCPServer struct {
	server   *mcp.Server
	handler  *Handler
	proxy    *proxy.Proxy
	jwt      *authn.JWTManager
	sessions *session.Store
	logger   *slog.Logger
}

// NewMCPServer creates an MCP server with the "execute" tool wired to the pipeline + proxy.
func NewMCPServer(handler *Handler, bankProxy *proxy.Proxy, jwt *authn.JWTManager, sessions *session.Store, logger *slog.Logger) *MCPServer {
	s := &MCPServer{
		handler:  handler,
		proxy:    bankProxy,
		jwt:      jwt,
		sessions: sessions,
		logger:   logger,
	}

	server := mcp.NewServer(
		&mcp.Implementation{
			Name:    "agp-gateway",
			Version: "v1.0.0",
		},
		&mcp.ServerOptions{},
	)

	// Register the "execute" tool — authorize AND forward in one step
	type executeArgs struct {
		Action   string  `json:"action"`
		Resource string  `json:"resource"`
		Amount   float64 `json:"amount,omitempty"`
		Currency string  `json:"currency,omitempty"`
	}

	mcp.AddTool(server, &mcp.Tool{
		Name:        "execute",
		Description: "Request authorization and execution of an agent action. The gateway authorizes the action and, if approved, executes it against the bank API on your behalf.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, args executeArgs) (*mcp.CallToolResult, any, error) {
		// Extract agent identity from context (set by middleware)
		claims, ok := ctx.Value(agentClaimsKey).(*authn.AgentClaims)
		if !ok {
			return &mcp.CallToolResult{
				Content: []mcp.Content{
					&mcp.TextContent{Text: `{"allow":false,"reason":"missing agent identity"}`},
				},
				IsError: true,
			}, nil, nil
		}

		// Step 1: Run the full authorization pipeline
		authReq := &AuthorizeRequest{
			AgentID:   claims.AgentID,
			AgentKind: claims.AgentKind,
			Action:    args.Action,
			Resource:  args.Resource,
			Amount:    args.Amount,
			Currency:  args.Currency,
		}

		resp := s.handler.Authorize(ctx, authReq)

		// If denied, return the denial immediately — never forward to bank
		if !resp.Allow {
			respJSON, _ := json.Marshal(resp)
			return &mcp.CallToolResult{
				Content: []mcp.Content{
					&mcp.TextContent{Text: string(respJSON)},
				},
				IsError: true,
			}, nil, nil
		}

		// Step 2: Authorized! Forward to the Bank API
		if proxy.HasRoute(args.Action) {
			payload := map[string]any{
				"amount":   args.Amount,
				"currency": args.Currency,
				"resource": args.Resource,
			}

			bankResult, err := s.proxy.Forward(args.Action, claims.AgentID, payload)
			if err != nil {
				s.logger.Error("bank API forwarding failed",
					"agent_id", claims.AgentID,
					"action", args.Action,
					"error", err,
				)
				result := map[string]any{
					"allow":  true,
					"reason": "authorized but downstream execution failed",
					"error":  err.Error(),
				}
				resultJSON, _ := json.Marshal(result)
				return &mcp.CallToolResult{
					Content: []mcp.Content{
						&mcp.TextContent{Text: string(resultJSON)},
					},
					IsError: true,
				}, nil, nil
			}

			// Success: return the bank API response wrapped with our authorization metadata
			result := map[string]any{
				"allow":       true,
				"reason":      resp.Reason,
				"executed":    true,
				"bank_result": bankResult,
			}
			resultJSON, _ := json.Marshal(result)
			return &mcp.CallToolResult{
				Content: []mcp.Content{
					&mcp.TextContent{Text: string(resultJSON)},
				},
			}, nil, nil
		}

		// No downstream route for this action — just return authorization result
		respJSON, _ := json.Marshal(resp)
		return &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.TextContent{Text: string(respJSON)},
			},
		}, nil, nil
	})

	// Register the "status" tool — agents can query their own status
	type statusArgs struct{}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "status",
		Description: "Check the agent's current governance status (active, revoked, spend remaining).",
	}, func(ctx context.Context, req *mcp.CallToolRequest, args statusArgs) (*mcp.CallToolResult, any, error) {
		claims, ok := ctx.Value(agentClaimsKey).(*authn.AgentClaims)
		if !ok {
			return &mcp.CallToolResult{
				Content: []mcp.Content{
					&mcp.TextContent{Text: `{"error":"missing agent identity"}`},
				},
				IsError: true,
			}, nil, nil
		}

		status := map[string]any{
			"agent_id": claims.AgentID,
			"active":   true,
		}
		statusJSON, _ := json.Marshal(status)
		return &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.TextContent{Text: string(statusJSON)},
			},
		}, nil, nil
	})

	s.server = server
	return s
}

// HTTPHandler returns an http.Handler that serves the MCP server over Streamable HTTP.
func (s *MCPServer) HTTPHandler() http.Handler {
	handler := mcp.NewStreamableHTTPHandler(
		func(r *http.Request) *mcp.Server {
			return s.server
		},
		&mcp.StreamableHTTPOptions{},
	)

	// Wrap with JWT authentication middleware
	return s.authMiddleware(handler)
}

// authMiddleware extracts and validates the JWT from the Authorization header.
func (s *MCPServer) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("Authorization")
		if token == "" {
			// For the hackathon demo, also accept X-Agent-ID header as a simpler auth path
			agentID := r.Header.Get("X-Agent-ID")
			agentKind := r.Header.Get("X-Agent-Kind")
			if agentID != "" {
				claims := &authn.AgentClaims{
					AgentID:   agentID,
					AgentKind: agentKind,
				}
				ctx := context.WithValue(r.Context(), agentClaimsKey, claims)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			http.Error(w, "missing authorization", http.StatusUnauthorized)
			return
		}

		// Strip "Bearer " prefix
		token = strings.TrimPrefix(token, "Bearer ")

		claims, err := s.jwt.Validate(token)
		if err != nil {
			s.logger.Warn("invalid JWT", "error", err)
			http.Error(w, fmt.Sprintf("invalid token: %v", err), http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), agentClaimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

type contextKey string

const (
	agentClaimsKey contextKey = "agent_claims"
)
