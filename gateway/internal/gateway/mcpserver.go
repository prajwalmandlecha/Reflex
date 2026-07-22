// mcpserver.go provides the inbound MCP server that agents connect to.
// It exposes an "authorize" tool that agents call for every action they want to take.
package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/agp/gateway/internal/authn"
	"github.com/agp/gateway/internal/session"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type MCPServer struct {
	server   *mcp.Server
	handler  *Handler
	jwt      *authn.JWTManager
	sessions *session.Store
	logger   *slog.Logger
}

func NewMCPServer(handler *Handler, jwt *authn.JWTManager, sessions *session.Store, logger *slog.Logger) *MCPServer {
	s := &MCPServer{
		handler:  handler,
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

	type authorizeArgs struct {
		Action   string  `json:"action"`
		Resource string  `json:"resource"`
		Amount   float64 `json:"amount,omitempty"`
		Currency string  `json:"currency,omitempty"`
	}

	mcp.AddTool(server, &mcp.Tool{
		Name:        "authorize",
		Description: "Request authorization for an agent action. Every action must be authorized before execution.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, args authorizeArgs) (*mcp.CallToolResult, any, error) {
		claims, ok := ctx.Value(agentClaimsKey).(*authn.AgentClaims)
		if !ok {
			return &mcp.CallToolResult{
				Content: []mcp.Content{
					&mcp.TextContent{Text: `{"allow":false,"reason":"missing agent identity"}`},
				},
				IsError: true,
			}, nil, nil
		}

		authReq := &AuthorizeRequest{
			AgentID:   claims.AgentID,
			AgentKind: claims.AgentKind,
			Action:    args.Action,
			Resource:  args.Resource,
			Amount:    args.Amount,
			Currency:  args.Currency,
		}

		resp := s.handler.Authorize(ctx, authReq)
		respJSON, _ := json.Marshal(resp)
		return &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.TextContent{Text: string(respJSON)},
			},
		}, nil, nil
	})

	s.server = server
	return s
}

func (s *MCPServer) HTTPHandler() http.Handler {
	handler := mcp.NewStreamableHTTPHandler(
		func(r *http.Request) *mcp.Server {
			return s.server
		},
		&mcp.StreamableHTTPOptions{},
	)

	return s.authMiddleware(handler)
}

func (s *MCPServer) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("Authorization")
		if token == "" {
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
