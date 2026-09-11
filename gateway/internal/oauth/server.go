package oauth

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/agp/gateway/internal/authn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Server handles RFC 8414, RFC 7591, RFC 9728, and OAuth 2.1 endpoints.
type Server struct {
	store           TokenStore
	jwtMgr          *authn.JWTManager
	issuer          string
	backendURL      string
	accessTokenTTL  time.Duration
	refreshTokenTTL time.Duration
	httpClient      *http.Client
	pool            *pgxpool.Pool
	logger          *slog.Logger
}


// NewServer creates a new OAuth 2.1 server handler with a Redis store.
func NewServer(
	rdb *redis.Client,
	jwtMgr *authn.JWTManager,
	issuer string,
	accessTokenTTL time.Duration,
	refreshTokenTTL time.Duration,
	logger *slog.Logger,
) *Server {
	return NewServerWithStore(NewRedisStore(rdb), jwtMgr, issuer, accessTokenTTL, refreshTokenTTL, logger)
}

// NewServerWithStore creates an OAuth 2.1 server handler with any TokenStore implementation.
func NewServerWithStore(
	store TokenStore,
	jwtMgr *authn.JWTManager,
	issuer string,
	accessTokenTTL time.Duration,
	refreshTokenTTL time.Duration,
	logger *slog.Logger,
) *Server {
	if accessTokenTTL <= 0 {
		accessTokenTTL = 1 * time.Hour
	}
	if refreshTokenTTL <= 0 {
		refreshTokenTTL = 30 * 24 * time.Hour
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Server{
		store:           store,
		jwtMgr:          jwtMgr,
		issuer:          issuer,
		accessTokenTTL:  accessTokenTTL,
		refreshTokenTTL: refreshTokenTTL,
		httpClient:      &http.Client{Timeout: 5 * time.Second},
		logger:          logger,
	}
}

// SetBackendURL sets the backend API URL for authenticating user credentials.
func (s *Server) SetBackendURL(backendURL string) {
	s.backendURL = strings.TrimRight(backendURL, "/")
}

// SetDBPool sets the postgres pool for querying active agent instances.
func (s *Server) SetDBPool(pool *pgxpool.Pool) {
	s.pool = pool
}

// getActiveAgentInstances queries active instances from the database.
func (s *Server) getActiveAgentInstances(ctx context.Context) []AgentInstanceOption {
	if s.pool == nil {
		return nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT i.id, COALESCE(c.name, i.class_id, '') AS class_name
		FROM agent_instances i
		LEFT JOIN agent_classes c ON i.class_id = c.id
		WHERE i.status = 'active'
		ORDER BY i.id ASC
	`)
	if err != nil {
		s.logger.Warn("failed to fetch active agent instances for authorize", "error", err)
		return nil
	}
	defer rows.Close()

	var list []AgentInstanceOption
	for rows.Next() {
		var opt AgentInstanceOption
		if err := rows.Scan(&opt.ID, &opt.ClassName); err == nil {
			list = append(list, opt)
		}
	}
	return list
}

// generateRandomToken generates a cryptographically random token with the given prefix.
func generateRandomToken(prefix string, byteLen int) string {
	b := make([]byte, byteLen)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%s%d", prefix, time.Now().UnixNano())
	}
	return prefix + hex.EncodeToString(b)
}

// getBaseURL derives the base server URL from the request headers.
func (s *Server) getBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := r.Host
	if xfh := r.Header.Get("X-Forwarded-Host"); xfh != "" {
		host = xfh
	}
	return fmt.Sprintf("%s://%s", scheme, host)
}

func sendOAuthError(w http.ResponseWriter, statusCode int, errCode, errDesc string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(ErrorResponse{
		Error:            errCode,
		ErrorDescription: errDesc,
	})
}

// HandleMetadata serves RFC 8414 Authorization Server Metadata.
func (s *Server) HandleMetadata(w http.ResponseWriter, r *http.Request) {
	baseURL := s.getBaseURL(r)

	meta := ServerMetadata{
		Issuer:                            baseURL,
		AuthorizationEndpoint:            baseURL + "/authorize",
		TokenEndpoint:                    baseURL + "/token",
		RegistrationEndpoint:             baseURL + "/register",
		RevocationEndpoint:               baseURL + "/revoke",
		TokenEndpointAuthMethodsSupported: []string{"client_secret_basic", "client_secret_post", "none"},
		GrantTypesSupported:               []string{"authorization_code", "client_credentials", "refresh_token"},
		ResponseTypesSupported:            []string{"code"},
		ScopesSupported:                   []string{"mcp"},
		CodeChallengeMethodsSupported:     []string{"S256", "plain"},
		ServiceDocumentation:              "https://modelcontextprotocol.io",
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(meta)
}

// HandleProtectedResourceMetadata serves RFC 9728 Protected Resource Metadata.
func (s *Server) HandleProtectedResourceMetadata(w http.ResponseWriter, r *http.Request) {
	baseURL := s.getBaseURL(r)
	resourceURL := baseURL + "/mcp"
	if qAgentID := r.URL.Query().Get("agent_id"); qAgentID != "" {
		resourceURL += "?agent_id=" + url.QueryEscape(qAgentID)
	}

	meta := ProtectedResourceMetadata{
		Resource:               resourceURL,
		AuthorizationServers:   []string{baseURL},
		ScopesSupported:        []string{"mcp"},
		BearerMethodsSupported: []string{"header"},
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(meta)
}

// HandleRegister handles RFC 7591 Dynamic Client Registration.
func (s *Server) HandleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendOAuthError(w, http.StatusMethodNotAllowed, "invalid_request", "method must be POST")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		sendOAuthError(w, http.StatusBadRequest, "invalid_request", "failed to read body")
		return
	}

	var req ClientRegistrationRequest
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			sendOAuthError(w, http.StatusBadRequest, "invalid_client_metadata", "invalid JSON")
			return
		}
	}

	clientID := generateRandomToken("agp_client_", 12)
	rawSecret := generateRandomToken("agp_sec_", 24)
	secretHash := HashValue(rawSecret)

	clientName := req.ClientName
	if clientName == "" {
		clientName = clientID
	}

	// Security: Check whether registration is performed by an authenticated operator/admin.
	// Anonymous/unauthenticated clients are strictly limited to authorization_code flow
	// (requiring human operator login and approval via /authorize). They CANNOT self-assign
	// agent_id, agent_kind, class_id, or client_credentials grant.
	_, userRole, hasAuth := s.extractSessionUser(r)
	isPrivileged := hasAuth && (userRole == "admin" || userRole == "operator")

	requestsClientCreds := false
	for _, gt := range req.GrantTypes {
		if gt == "client_credentials" {
			requestsClientCreds = true
			break
		}
	}

	if !isPrivileged {
		if requestsClientCreds {
			sendOAuthError(w, http.StatusForbidden, "access_denied", "client_credentials grant requires authenticated registration with Initial Access Token")
			return
		}
		if req.AgentID != "" || req.ClassID != "" || req.AgentKind != "" {
			sendOAuthError(w, http.StatusForbidden, "access_denied", "binding specific agent_id or class_id requires authenticated registration")
			return
		}
	}

	var grantTypes []string
	if len(req.GrantTypes) == 0 {
		if isPrivileged {
			grantTypes = []string{"authorization_code", "client_credentials", "refresh_token"}
		} else {
			grantTypes = []string{"authorization_code", "refresh_token"}
		}
	} else if !isPrivileged {
		for _, gt := range req.GrantTypes {
			if gt != "client_credentials" {
				grantTypes = append(grantTypes, gt)
			}
		}
		if len(grantTypes) == 0 {
			grantTypes = []string{"authorization_code", "refresh_token"}
		}
	} else {
		grantTypes = req.GrantTypes
	}

	var agentID, agentKind, classID string
	if isPrivileged {
		agentID = req.AgentID
		classID = req.ClassID
		agentKind = req.AgentKind
		if agentID != "" && s.pool != nil {
			var dbClass string
			err := s.pool.QueryRow(r.Context(), `SELECT class_id FROM agent_instances WHERE id = $1`, agentID).Scan(&dbClass)
			if err != nil {
				sendOAuthError(w, http.StatusBadRequest, "invalid_client_metadata", fmt.Sprintf("agent_id %q not found in agent_instances", agentID))
				return
			}
			if dbClass != "" {
				classID = dbClass
				agentKind = dbClass
			}
		}
		if agentKind == "" {
			if classID != "" {
				agentKind = classID
			} else {
				agentKind = "custom"
			}
		}
	}

	client := &OAuthClient{
		ClientID:         clientID,
		ClientSecretHash: secretHash,
		ClientName:       clientName,
		GrantTypes:       grantTypes,
		RedirectURIs:     req.RedirectURIs,
		AgentID:          agentID,
		AgentKind:        agentKind,
		ClassID:          classID,
		CreatedAt:        time.Now().UTC(),
	}

	// Persist client to Redis (30-day default registration TTL)
	if err := s.store.SaveClient(r.Context(), client, s.refreshTokenTTL); err != nil {
		s.logger.Error("failed to save oauth client", "error", err)
		sendOAuthError(w, http.StatusInternalServerError, "server_error", "failed to register client")
		return
	}

	resp := ClientRegistrationResponse{
		ClientID:                clientID,
		ClientSecret:            rawSecret,
		ClientIDIssuedAt:        time.Now().Unix(),
		ClientSecretExpiresAt:   0, // 0 = does not expire
		ClientName:              clientName,
		GrantTypes:              grantTypes,
		TokenEndpointAuthMethod: "client_secret_post",
		RedirectURIs:            req.RedirectURIs,
		Scope:                   "mcp",
		AgentID:                 agentID,
		AgentKind:               agentKind,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(resp)
}

// AuthorizePageData holds data passed to the HTML authorization consent template.
type AuthorizePageData struct {
	ClientName          string
	ClientID            string
	RedirectURI         string
	ResponseType        string
	CodeChallenge       string
	CodeChallengeMethod string
	State               string
	Scope               string
	AgentID             string
	AgentInstances      []AgentInstanceOption
	LoggedInUser        string
	UserRole            string
	Error               string
}


const authorizeHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize MCP Client — Reflex AGP</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #030712;
      background-image: radial-gradient(circle at 50% 0%, rgba(6, 182, 212, 0.08) 0%, transparent 60%),
                        radial-gradient(circle at 100% 100%, rgba(16, 185, 129, 0.04) 0%, transparent 50%);
      color: #f8fafc;
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      width: 100%;
      max-width: 440px;
      padding: 2rem;
    }
    .mono { font-family: 'IBM Plex Mono', monospace; }
    .header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .logo-badge {
      background: linear-gradient(135deg, #06b6d4, #0284c7);
      color: #020617;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.75rem;
      font-weight: 800;
      padding: 0.35rem 0.6rem;
      border-radius: 6px;
      letter-spacing: 0.05em;
    }
    .brand-title {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: #f8fafc;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .live-badge {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      font-size: 0.65rem;
      padding: 0.15rem 0.4rem;
      border-radius: 9999px;
      font-weight: 600;
    }
    .brand-sub {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.65rem;
      color: #64748b;
      letter-spacing: 0.15em;
      text-transform: uppercase;
    }
    .client-box {
      background: rgba(6, 182, 212, 0.05);
      border: 1px solid rgba(6, 182, 212, 0.2);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1.25rem;
    }
    .client-title {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.75rem;
      color: #38bdf8;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .client-name {
      font-size: 1.1rem;
      font-weight: 600;
      color: #f8fafc;
      margin-bottom: 0.25rem;
    }
    .client-desc {
      font-size: 0.8rem;
      color: #94a3b8;
      line-height: 1.4;
    }
    .user-card {
      background: rgba(6, 182, 212, 0.08);
      border: 1px solid rgba(6, 182, 212, 0.25);
      border-radius: 8px;
      padding: 0.75rem 0.9rem;
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .user-avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: rgba(6, 182, 212, 0.2);
      border: 1px solid rgba(6, 182, 212, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
    }
    .user-name {
      font-size: 0.85rem;
      font-weight: 600;
      color: #f8fafc;
    }
    .user-sub {
      font-size: 0.7rem;
      color: #94a3b8;
      font-family: 'IBM Plex Mono', monospace;
      margin-top: 0.15rem;
    }
    .role-pill {
      display: inline-block;
      background: rgba(6, 182, 212, 0.15);
      color: #38bdf8;
      padding: 0.05rem 0.35rem;
      border-radius: 4px;
      font-size: 0.65rem;
      text-transform: uppercase;
      font-weight: 600;
    }
    .form-group {
      margin-bottom: 1rem;
    }
    .label {
      display: block;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #94a3b8;
      margin-bottom: 0.4rem;
    }
    .input {
      width: 100%;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      padding: 0.65rem 0.85rem;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.85rem;
      color: #f8fafc;
      transition: all 0.2s;
    }
    .input:focus {
      outline: none;
      border-color: #06b6d4;
      background: rgba(6, 182, 212, 0.05);
      box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.2);
    }
    select.input {
      appearance: none;
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2306b6d4' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 0.75rem center;
      background-size: 1em;
      padding-right: 2rem;
      cursor: pointer;
    }
    select.input option {
      background: #090e17;
      color: #f8fafc;
    }
    .demo-bar {
      display: flex;
      gap: 0.4rem;
      margin-bottom: 1.25rem;
    }
    .demo-btn {
      flex: 1;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 0.4rem 0.5rem;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.7rem;
      color: #cbd5e1;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }
    .demo-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #f8fafc;
      border-color: rgba(255, 255, 255, 0.2);
    }
    .actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }
    .btn {
      flex: 1;
      padding: 0.75rem 1rem;
      border-radius: 6px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
      text-align: center;
      text-decoration: none;
    }
    .btn-primary {
      background: #06b6d4;
      color: #020617;
      box-shadow: 0 0 15px -3px rgba(6, 182, 212, 0.4);
    }
    .btn-primary:hover {
      background: #22d3ee;
      box-shadow: 0 0 20px -2px rgba(6, 182, 212, 0.6);
    }
    .btn-secondary {
      background: transparent;
      color: #94a3b8;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.05);
      color: #f8fafc;
      border-color: rgba(255, 255, 255, 0.2);
    }
    .error-msg {
      background: rgba(244, 63, 94, 0.1);
      border: 1px solid rgba(244, 63, 94, 0.3);
      color: #fb7185;
      padding: 0.6rem 0.8rem;
      border-radius: 6px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.75rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo-badge">AGP</div>
      <div>
        <div class="brand-title">
          REFLEX AGP <span class="live-badge">LIVE</span>
        </div>
        <div class="brand-sub">MCP Authorization Consent</div>
      </div>
    </div>

    {{if .Error}}
    <div class="error-msg">⚠ {{.Error}}</div>
    {{end}}

    <div class="client-box">
      <div class="client-title">Connection Request</div>
      <div class="client-name">{{.ClientName}}</div>
      <div class="client-desc">
        {{.ClientName}} is requesting authorization to connect as an autonomous MCP agent.
      </div>
    </div>

    <form method="POST" action="/authorize">
      <input type="hidden" name="client_id" value="{{.ClientID}}">
      <input type="hidden" name="redirect_uri" value="{{.RedirectURI}}">
      <input type="hidden" name="response_type" value="{{.ResponseType}}">
      <input type="hidden" name="code_challenge" value="{{.CodeChallenge}}">
      <input type="hidden" name="code_challenge_method" value="{{.CodeChallengeMethod}}">
      <input type="hidden" name="state" value="{{.State}}">
      <input type="hidden" name="scope" value="{{.Scope}}">

      <div class="form-group">
        <label class="label">Target Agent Instance</label>
        {{if .AgentInstances}}
        <select name="agent_id" class="input" required>
          {{$selected := .AgentID}}
          {{range .AgentInstances}}
          <option value="{{.ID}}" {{if eq .ID $selected}}selected{{end}}>
            {{.ID}}{{if .ClassName}} ({{.ClassName}}){{end}}
          </option>
          {{end}}
        </select>
        {{else}}
        <input type="text" name="agent_id" value="{{.AgentID}}" class="input" placeholder="e.g. banking-full-814131" required>
        {{end}}
      </div>

      {{if .LoggedInUser}}
      <div class="user-card">
        <div class="user-avatar">👤</div>
        <div style="flex: 1;">
          <div class="user-name">Signed in as <strong>{{.LoggedInUser}}</strong></div>
          <div class="user-sub"><span class="role-pill">{{.UserRole}}</span> &middot; Active Session</div>
        </div>
      </div>
      <input type="hidden" name="email" value="{{.LoggedInUser}}">
      {{else}}
      <div class="form-group">
        <label class="label">Operator Email</label>
        <input type="email" id="emailInput" name="email" class="input" placeholder="operator@reflex.local" required>
      </div>

      <div class="form-group">
        <label class="label">Operator Password</label>
        <input type="password" id="passwordInput" name="password" class="input" placeholder="••••••••" required>
      </div>

      <label class="label" style="font-size: 0.65rem; margin-bottom: 0.3rem;">Quick Demo Fill:</label>
      <div class="demo-bar">
        <button type="button" class="demo-btn" onclick="fillDemo('admin@reflex.local', 'AdminPass123!')">Admin</button>
        <button type="button" class="demo-btn" onclick="fillDemo('operator@reflex.local', 'OperatorPass123!')">Operator</button>
        <button type="button" class="demo-btn" onclick="fillDemo('auditor@reflex.local', 'AuditorPass123!')">Auditor</button>
      </div>
      {{end}}

      <div class="actions">
        <button type="submit" name="action" value="deny" class="btn btn-secondary">Deny</button>
        <button type="submit" name="action" value="approve" class="btn btn-primary">Authorize Access</button>
      </div>
    </form>
  </div>

  <script>
    function fillDemo(email, pass) {
      const e = document.getElementById('emailInput');
      const p = document.getElementById('passwordInput');
      if (e) e.value = email;
      if (p) p.value = pass;
    }
  </script>
</body>
</html>`


// extractSessionUser extracts and validates any existing dashboard user session cookie or Bearer token.
func (s *Server) extractSessionUser(r *http.Request) (string, string, bool) {
	var tokenStr string
	if cookie, err := r.Cookie("reflex_auth_token"); err == nil && cookie.Value != "" {
		tokenStr = cookie.Value
	} else if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		tokenStr = strings.TrimPrefix(auth, "Bearer ")
	}

	if tokenStr == "" {
		return "", "", false
	}

	claims, err := s.jwtMgr.ValidateUserSession(tokenStr)
	if err == nil && claims != nil && claims.Email != "" {
		role := claims.Role
		if role == "" {
			role = "operator"
		}
		return claims.Email, role, true
	}
	return "", "", false
}

// HandleAuthorize handles GET and POST /authorize requests (OAuth 2.1 Authorization Code Grant + PKCE).
func (s *Server) HandleAuthorize(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		s.handleAuthorizeGet(w, r)
		return
	} else if r.Method == http.MethodPost {
		s.handleAuthorizePost(w, r)
		return
	}
	sendOAuthError(w, http.StatusMethodNotAllowed, "invalid_request", "method must be GET or POST")
}

func (s *Server) handleAuthorizeGet(w http.ResponseWriter, r *http.Request) {
	clientID := r.URL.Query().Get("client_id")
	if clientID == "" {
		sendOAuthError(w, http.StatusBadRequest, "invalid_request", "missing client_id")
		return
	}

	client, err := s.store.GetClient(r.Context(), clientID)
	if err != nil {
		sendOAuthError(w, http.StatusUnauthorized, "invalid_client", "unknown client_id")
		return
	}

	redirectURI := r.URL.Query().Get("redirect_uri")
	if redirectURI == "" && len(client.RedirectURIs) > 0 {
		redirectURI = client.RedirectURIs[0]
	}

	responseType := r.URL.Query().Get("response_type")
	if responseType != "code" {
		sendOAuthError(w, http.StatusBadRequest, "unsupported_response_type", "response_type must be 'code'")
		return
	}

	codeChallenge := r.URL.Query().Get("code_challenge")
	codeChallengeMethod := r.URL.Query().Get("code_challenge_method")
	if codeChallengeMethod == "" {
		codeChallengeMethod = "S256"
	}

	state := r.URL.Query().Get("state")
	scope := r.URL.Query().Get("scope")
	if scope == "" {
		scope = "mcp"
	}

	activeInstances := s.getActiveAgentInstances(r.Context())
	agentID := r.URL.Query().Get("agent_id")
	if agentID == "" {
		agentID = client.AgentID
	}
	if agentID == "" && len(activeInstances) > 0 {
		agentID = activeInstances[0].ID
	}

	loggedInUser, userRole, _ := s.extractSessionUser(r)

	tmpl, err := template.New("authorize").Parse(authorizeHTML)
	if err != nil {
		s.logger.Error("failed to parse authorize template", "error", err)
		http.Error(w, "template error", http.StatusInternalServerError)
		return
	}

	data := AuthorizePageData{
		ClientName:          client.ClientName,
		ClientID:            clientID,
		RedirectURI:         redirectURI,
		ResponseType:        responseType,
		CodeChallenge:       codeChallenge,
		CodeChallengeMethod: codeChallengeMethod,
		State:               state,
		Scope:               scope,
		AgentID:             agentID,
		AgentInstances:      activeInstances,
		LoggedInUser:        loggedInUser,
		UserRole:            userRole,
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = tmpl.Execute(w, data)
}

func (s *Server) handleAuthorizePost(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		sendOAuthError(w, http.StatusBadRequest, "invalid_request", "failed to parse form")
		return
	}

	action := r.FormValue("action")
	redirectURI := r.FormValue("redirect_uri")
	state := r.FormValue("state")
	clientID := r.FormValue("client_id")
	agentID := r.FormValue("agent_id")
	codeChallenge := r.FormValue("code_challenge")
	codeChallengeMethod := r.FormValue("code_challenge_method")
	scope := r.FormValue("scope")

	if action == "deny" {
		sep := "?"
		if strings.Contains(redirectURI, "?") {
			sep = "&"
		}
		target := fmt.Sprintf("%s%serror=access_denied&error_description=User+denied+access", redirectURI, sep)
		if state != "" {
			target += "&state=" + url.QueryEscape(state)
		}
		http.Redirect(w, r, target, http.StatusFound)
		return
	}

	// Check if caller already has an active session cookie / token
	var email string
	if loggedIn, _, ok := s.extractSessionUser(r); ok && loggedIn != "" {
		email = loggedIn
	} else {
		email = strings.TrimSpace(r.FormValue("email"))
		password := strings.TrimSpace(r.FormValue("password"))
		authenticated, _, err := s.authenticateUser(r.Context(), email, password)
		if !authenticated || err != nil {
			client, _ := s.store.GetClient(r.Context(), clientID)
			clientName := clientID
			if client != nil {
				clientName = client.ClientName
			}
			tmpl, _ := template.New("authorize").Parse(authorizeHTML)
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			_ = tmpl.Execute(w, AuthorizePageData{
				ClientName:          clientName,
				ClientID:            clientID,
				RedirectURI:         redirectURI,
				ResponseType:        "code",
				CodeChallenge:       codeChallenge,
				CodeChallengeMethod: codeChallengeMethod,
				State:               state,
				Scope:               scope,
				AgentID:             agentID,
				AgentInstances:      s.getActiveAgentInstances(r.Context()),
				Error:               "Invalid email or password. Use demo accounts (e.g. operator@reflex.local / operator123).",
			})
			return
		}
	}


	if agentID == "" {
		agentID = "custom-agent"
	}

	// Look up the actual class_id for the selected agent instance from database,
	// rather than stamping the human operator's role into AgentKind.
	agentKind := "custom"
	classID := ""
	if s.pool != nil && agentID != "" && agentID != "custom-agent" {
		var dbClass string
		err := s.pool.QueryRow(r.Context(), `SELECT class_id FROM agent_instances WHERE id = $1`, agentID).Scan(&dbClass)
		if err == nil && dbClass != "" {
			agentKind = dbClass
			classID = dbClass
		}
	}

	authCode := generateRandomToken("agp_code_", 32)
	codeRecord := &AuthorizationCodeRecord{
		Code:                authCode,
		ClientID:            clientID,
		UserID:              email,
		AgentID:             agentID,
		AgentKind:           agentKind,
		ClassID:             classID,
		CodeChallenge:       codeChallenge,
		CodeChallengeMethod: codeChallengeMethod,
		RedirectURI:         redirectURI,
		Scope:               scope,
		CreatedAt:           time.Now().UTC(),
		ExpiresAt:           time.Now().UTC().Add(5 * time.Minute),
	}

	if err := s.store.SaveAuthCode(r.Context(), authCode, codeRecord, 5*time.Minute); err != nil {
		s.logger.Error("failed to save authorization code", "error", err)
		sendOAuthError(w, http.StatusInternalServerError, "server_error", "failed to issue authorization code")
		return
	}

	sep := "?"
	if strings.Contains(redirectURI, "?") {
		sep = "&"
	}
	target := fmt.Sprintf("%s%scode=%s", redirectURI, sep, url.QueryEscape(authCode))
	if state != "" {
		target += "&state=" + url.QueryEscape(state)
	}

	http.Redirect(w, r, target, http.StatusFound)
}

// authenticateUser verifies user credentials against the backend login API or demo accounts.
func (s *Server) authenticateUser(ctx context.Context, email, password string) (bool, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))

	// 1. Check Backend API if configured
	if s.backendURL != "" {
		loginPayload, _ := json.Marshal(map[string]string{
			"email":    email,
			"password": password,
		})
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.backendURL+"/api/v1/auth/login", bytes.NewReader(loginPayload))
		if err == nil {
			req.Header.Set("Content-Type", "application/json")
			resp, err := s.httpClient.Do(req)
			if err == nil {
				defer resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					var result struct {
						User struct {
							Role string `json:"role"`
						} `json:"user"`
					}
					if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
						role := result.User.Role
						if role == "" {
							role = "operator"
						}
						return true, role, nil
					}
					return true, "operator", nil
				}
			}
		}
	}

	// 2. Built-in Demo accounts fallback (dev mode only)
	if os.Getenv("AGP_ENV") == "dev" {
		switch email {
		case "admin@reflex.local":
			if password == "admin123" {
				return true, "admin", nil
			}
		case "operator@reflex.local":
			if password == "operator123" {
				return true, "operator", nil
			}
		case "auditor@reflex.local":
			if password == "auditor123" {
				return true, "auditor", nil
			}
		}
	}

	return false, "", nil
}

// parseTokenRequest extracts parameters from either form-encoded or JSON body and Basic auth header.
func parseTokenRequest(r *http.Request) (*TokenRequest, error) {
	req := &TokenRequest{}

	// 1. Check HTTP Basic Auth (Authorization: Basic <base64(client_id:client_secret)>)
	if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Basic ") {
		encoded := strings.TrimPrefix(authHeader, "Basic ")
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err == nil {
			parts := strings.SplitN(string(decoded), ":", 2)
			if len(parts) == 2 {
				req.ClientID = parts[0]
				req.ClientSecret = parts[1]
			}
		}
	}

	// 2. Parse body (JSON or Form URL-encoded)
	contentType := r.Header.Get("Content-Type")
	if strings.Contains(contentType, "application/json") {
		body, err := io.ReadAll(r.Body)
		if err == nil && len(body) > 0 {
			_ = json.Unmarshal(body, req)
		}
	} else {
		_ = r.ParseForm()
		if gt := r.FormValue("grant_type"); gt != "" {
			req.GrantType = gt
		}
		if cid := r.FormValue("client_id"); cid != "" {
			req.ClientID = cid
		}
		if sec := r.FormValue("client_secret"); sec != "" {
			req.ClientSecret = sec
		}
		if rt := r.FormValue("refresh_token"); rt != "" {
			req.RefreshToken = rt
		}
		if code := r.FormValue("code"); code != "" {
			req.Code = code
		}
		if cv := r.FormValue("code_verifier"); cv != "" {
			req.CodeVerifier = cv
		}
		if ru := r.FormValue("redirect_uri"); ru != "" {
			req.RedirectURI = ru
		}
		if sc := r.FormValue("scope"); sc != "" {
			req.Scope = sc
		}
	}

	return req, nil
}

// HandleToken handles POST /token requests.
func (s *Server) HandleToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendOAuthError(w, http.StatusMethodNotAllowed, "invalid_request", "method must be POST")
		return
	}

	req, err := parseTokenRequest(r)
	if err != nil {
		sendOAuthError(w, http.StatusBadRequest, "invalid_request", "malformed token request")
		return
	}

	switch req.GrantType {
	case "authorization_code":
		s.handleAuthorizationCodeGrant(w, r, req)
	case "client_credentials":
		s.handleClientCredentialsGrant(w, r, req)
	case "refresh_token":
		s.handleRefreshTokenGrant(w, r, req)
	default:
		sendOAuthError(w, http.StatusBadRequest, "unsupported_grant_type",
			fmt.Sprintf("grant_type %q is not supported", req.GrantType))
	}
}

// handleAuthorizationCodeGrant handles grant_type=authorization_code with PKCE validation.
func (s *Server) handleAuthorizationCodeGrant(w http.ResponseWriter, r *http.Request, req *TokenRequest) {
	if req.Code == "" {
		sendOAuthError(w, http.StatusBadRequest, "invalid_request", "missing code")
		return
	}

	// Consume code (single-use)
	record, err := s.store.ConsumeAuthCode(r.Context(), req.Code)
	if err != nil {
		sendOAuthError(w, http.StatusBadRequest, "invalid_grant", "authorization code invalid, expired, or already used")
		return
	}

	// Verify client_id matches
	if req.ClientID != "" && req.ClientID != record.ClientID {
		sendOAuthError(w, http.StatusUnauthorized, "invalid_client", "client_id mismatch")
		return
	}

	// Verify client exists and is authorized for authorization_code grant
	client, err := s.store.GetClient(r.Context(), record.ClientID)
	if err != nil {
		sendOAuthError(w, http.StatusUnauthorized, "invalid_client", "client not found")
		return
	}
	authorized := false
	for _, gt := range client.GrantTypes {
		if gt == "authorization_code" {
			authorized = true
			break
		}
	}
	if !authorized {
		sendOAuthError(w, http.StatusUnauthorized, "unauthorized_client", "client is not authorized for authorization_code grant")
		return
	}

	// Verify redirect_uri matches if specified in authorization request
	if record.RedirectURI != "" && req.RedirectURI != "" && req.RedirectURI != record.RedirectURI {
		sendOAuthError(w, http.StatusBadRequest, "invalid_grant", "redirect_uri mismatch")
		return
	}

	// Verify PKCE
	if record.CodeChallenge != "" {
		if req.CodeVerifier == "" {
			sendOAuthError(w, http.StatusBadRequest, "invalid_grant", "missing code_verifier (PKCE required)")
			return
		}

		if record.CodeChallengeMethod == "S256" || record.CodeChallengeMethod == "" {
			sum := sha256.Sum256([]byte(req.CodeVerifier))
			computedChallenge := base64.RawURLEncoding.EncodeToString(sum[:])
			if !hmac.Equal([]byte(computedChallenge), []byte(record.CodeChallenge)) {
				sendOAuthError(w, http.StatusBadRequest, "invalid_grant", "PKCE code_verifier verification failed")
				return
			}
		} else if record.CodeChallengeMethod == "plain" {
			if !hmac.Equal([]byte(req.CodeVerifier), []byte(record.CodeChallenge)) {
				sendOAuthError(w, http.StatusBadRequest, "invalid_grant", "PKCE code_verifier verification failed")
				return
			}
		}
	}

	// Mint Access Token JWT
	accessToken, err := s.jwtMgr.MintWithTTL(record.AgentID, record.AgentKind, 1, s.accessTokenTTL)
	if err != nil {
		s.logger.Error("failed to mint access token", "error", err)
		sendOAuthError(w, http.StatusInternalServerError, "server_error", "failed to mint token")
		return
	}

	// Generate and persist Refresh Token
	refreshToken := generateRandomToken("agp_rt_", 32)
	refreshRecord := &RefreshTokenRecord{
		ClientID:      record.ClientID,
		AgentID:       record.AgentID,
		AgentKind:     record.AgentKind,
		PolicyVersion: 1,
		ClassID:       record.ClassID,
		Scope:         record.Scope,
		CreatedAt:     time.Now().UTC(),
		ExpiresAt:     time.Now().UTC().Add(s.refreshTokenTTL),
	}

	if err := s.store.SaveRefreshToken(r.Context(), refreshToken, refreshRecord, s.refreshTokenTTL); err != nil {
		s.logger.Error("failed to save refresh token", "error", err)
		sendOAuthError(w, http.StatusInternalServerError, "server_error", "failed to save refresh token")
		return
	}

	resp := TokenResponse{
		AccessToken:  accessToken,
		TokenType:    "Bearer",
		ExpiresIn:    int64(s.accessTokenTTL.Seconds()),
		RefreshToken: refreshToken,
		Scope:        record.Scope,
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// handleClientCredentialsGrant handles grant_type=client_credentials.
func (s *Server) handleClientCredentialsGrant(w http.ResponseWriter, r *http.Request, req *TokenRequest) {
	if req.ClientID == "" {
		sendOAuthError(w, http.StatusBadRequest, "invalid_client", "missing client_id")
		return
	}

	client, err := s.store.GetClient(r.Context(), req.ClientID)
	if err != nil {
		sendOAuthError(w, http.StatusUnauthorized, "invalid_client", "client not found")
		return
	}

	// Verify client is authorized for client_credentials
	authorized := false
	for _, gt := range client.GrantTypes {
		if gt == "client_credentials" {
			authorized = true
			break
		}
	}
	if !authorized {
		sendOAuthError(w, http.StatusUnauthorized, "unauthorized_client", "client is not authorized for client_credentials grant")
		return
	}

	if client.ClientSecretHash != "" && !s.store.VerifyClientSecret(client, req.ClientSecret) {
		sendOAuthError(w, http.StatusUnauthorized, "invalid_client", "invalid client_secret")
		return
	}

	// Mint Access Token JWT
	agentID := client.AgentID
	if agentID == "" {
		agentID = client.ClientID
	}
	agentKind := client.AgentKind
	if agentKind == "" {
		agentKind = "custom"
	}

	accessToken, err := s.jwtMgr.MintWithTTL(agentID, agentKind, 1, s.accessTokenTTL)
	if err != nil {
		s.logger.Error("failed to mint access token", "error", err)
		sendOAuthError(w, http.StatusInternalServerError, "server_error", "failed to mint token")
		return
	}

	// Generate and persist Refresh Token
	refreshToken := generateRandomToken("agp_rt_", 32)
	refreshRecord := &RefreshTokenRecord{
		ClientID:      client.ClientID,
		AgentID:       agentID,
		AgentKind:     agentKind,
		PolicyVersion: 1,
		ClassID:       client.ClassID,
		Scope:         "mcp",
		CreatedAt:     time.Now().UTC(),
		ExpiresAt:     time.Now().UTC().Add(s.refreshTokenTTL),
	}

	if err := s.store.SaveRefreshToken(r.Context(), refreshToken, refreshRecord, s.refreshTokenTTL); err != nil {
		s.logger.Error("failed to save refresh token", "error", err)
		sendOAuthError(w, http.StatusInternalServerError, "server_error", "failed to save refresh token")
		return
	}

	resp := TokenResponse{
		AccessToken:  accessToken,
		TokenType:    "Bearer",
		ExpiresIn:    int64(s.accessTokenTTL.Seconds()),
		RefreshToken: refreshToken,
		Scope:        "mcp",
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// handleRefreshTokenGrant handles grant_type=refresh_token with single-use rotation.
func (s *Server) handleRefreshTokenGrant(w http.ResponseWriter, r *http.Request, req *TokenRequest) {
	if req.RefreshToken == "" {
		sendOAuthError(w, http.StatusBadRequest, "invalid_request", "missing refresh_token")
		return
	}

	// Single-use rotation: consume the old refresh token immediately.
	record, err := s.store.ConsumeRefreshToken(r.Context(), req.RefreshToken)
	if err != nil {
		sendOAuthError(w, http.StatusBadRequest, "invalid_grant", "refresh token invalid or expired")
		return
	}

	// If client credentials are provided, verify they match the refresh token record.
	if req.ClientID != "" && req.ClientID != record.ClientID {
		sendOAuthError(w, http.StatusUnauthorized, "invalid_client", "client_id does not match refresh token")
		return
	}

	// Mint new Access Token JWT
	accessToken, err := s.jwtMgr.MintWithTTL(record.AgentID, record.AgentKind, record.PolicyVersion, s.accessTokenTTL)
	if err != nil {
		s.logger.Error("failed to mint refreshed access token", "error", err)
		sendOAuthError(w, http.StatusInternalServerError, "server_error", "failed to mint token")
		return
	}

	// Generate and save a new rotated Refresh Token
	newRefreshToken := generateRandomToken("agp_rt_", 32)
	newRecord := &RefreshTokenRecord{
		ClientID:      record.ClientID,
		AgentID:       record.AgentID,
		AgentKind:     record.AgentKind,
		PolicyVersion: record.PolicyVersion,
		ClassID:       record.ClassID,
		Scope:         record.Scope,
		CreatedAt:     time.Now().UTC(),
		ExpiresAt:     time.Now().UTC().Add(s.refreshTokenTTL),
	}

	if err := s.store.SaveRefreshToken(r.Context(), newRefreshToken, newRecord, s.refreshTokenTTL); err != nil {
		s.logger.Error("failed to save new refresh token during rotation", "error", err)
		sendOAuthError(w, http.StatusInternalServerError, "server_error", "failed to save rotated refresh token")
		return
	}

	resp := TokenResponse{
		AccessToken:  accessToken,
		TokenType:    "Bearer",
		ExpiresIn:    int64(s.accessTokenTTL.Seconds()),
		RefreshToken: newRefreshToken,
		Scope:        record.Scope,
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// HandleRevoke handles RFC 7009 Token Revocation.
func (s *Server) HandleRevoke(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendOAuthError(w, http.StatusMethodNotAllowed, "invalid_request", "method must be POST")
		return
	}

	_ = r.ParseForm()
	token := r.FormValue("token")
	if token == "" {
		body, _ := io.ReadAll(r.Body)
		var jsonReq struct {
			Token string `json:"token"`
		}
		_ = json.Unmarshal(body, &jsonReq)
		token = jsonReq.Token
	}

	if token != "" {
		_ = s.store.RevokeToken(r.Context(), token)
	}

	// RFC 7009: Successful revocation must return 200 OK regardless of whether token existed
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{}`))
}
