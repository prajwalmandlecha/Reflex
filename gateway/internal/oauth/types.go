// Package oauth provides RFC 8414 Discovery, RFC 7591 Dynamic Client Registration,
// and OAuth 2.1 Token Issuance & Refresh Token Rotation for MCP clients.
package oauth

import "time"

// ServerMetadata represents the RFC 8414 Authorization Server Metadata.
type ServerMetadata struct {
	Issuer                                string   `json:"issuer"`
	AuthorizationEndpoint                 string   `json:"authorization_endpoint,omitempty"`
	TokenEndpoint                         string   `json:"token_endpoint"`
	RegistrationEndpoint                  string   `json:"registration_endpoint,omitempty"`
	RevocationEndpoint                    string   `json:"revocation_endpoint,omitempty"`
	TokenEndpointAuthMethodsSupported     []string `json:"token_endpoint_auth_methods_supported"`
	GrantTypesSupported                   []string `json:"grant_types_supported"`
	ResponseTypesSupported                []string `json:"response_types_supported"`
	ScopesSupported                       []string `json:"scopes_supported,omitempty"`
	CodeChallengeMethodsSupported         []string `json:"code_challenge_methods_supported,omitempty"`
	ServiceDocumentation                  string   `json:"service_documentation,omitempty"`
}

// ClientRegistrationRequest represents an RFC 7591 Dynamic Client Registration request.
type ClientRegistrationRequest struct {
	ClientName              string   `json:"client_name"`
	GrantTypes              []string `json:"grant_types,omitempty"`
	RedirectURIs            []string `json:"redirect_uris,omitempty"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method,omitempty"`
	Scope                   string   `json:"scope,omitempty"`
	AgentID                 string   `json:"agent_id,omitempty"`
	AgentKind               string   `json:"agent_kind,omitempty"`
	ClassID                 string   `json:"class_id,omitempty"`
}

// ClientRegistrationResponse represents an RFC 7591 Dynamic Client Registration response.
type ClientRegistrationResponse struct {
	ClientID                string   `json:"client_id"`
	ClientSecret            string   `json:"client_secret,omitempty"`
	ClientIDIssuedAt        int64    `json:"client_id_issued_at"`
	ClientSecretExpiresAt   int64    `json:"client_secret_expires_at"`
	ClientName              string   `json:"client_name"`
	GrantTypes              []string `json:"grant_types"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	RedirectURIs            []string `json:"redirect_uris,omitempty"`
	Scope                   string   `json:"scope,omitempty"`
	AgentID                 string   `json:"agent_id"`
	AgentKind               string   `json:"agent_kind"`
}

// OAuthClient is the internal persisted representation of an OAuth client in Redis.
type OAuthClient struct {
	ClientID         string    `json:"client_id"`
	ClientSecretHash string    `json:"client_secret_hash,omitempty"`
	ClientName       string    `json:"client_name"`
	GrantTypes       []string  `json:"grant_types"`
	RedirectURIs     []string  `json:"redirect_uris,omitempty"`
	AgentID          string    `json:"agent_id"`
	AgentKind        string    `json:"agent_kind"`
	ClassID          string    `json:"class_id,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

// TokenRequest contains the parsed parameters for a POST /token request.
type TokenRequest struct {
	GrantType    string `json:"grant_type"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	RefreshToken string `json:"refresh_token"`
	Code         string `json:"code"`
	CodeVerifier string `json:"code_verifier"`
	RedirectURI  string `json:"redirect_uri"`
	Scope        string `json:"scope"`
}

// TokenResponse represents a successful OAuth 2.0 token response.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"` // in seconds
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope,omitempty"`
}

// RefreshTokenRecord is stored in Redis under agp:oauth:refresh:{token_hash}.
type RefreshTokenRecord struct {
	ClientID      string    `json:"client_id"`
	AgentID       string    `json:"agent_id"`
	AgentKind     string    `json:"agent_kind"`
	PolicyVersion int       `json:"policy_version"`
	ClassID       string    `json:"class_id,omitempty"`
	Scope         string    `json:"scope,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	ExpiresAt     time.Time `json:"expires_at"`
}

// AuthorizationCodeRecord is stored in Redis under agp:oauth:code:{code_hash}.
type AuthorizationCodeRecord struct {
	Code                string    `json:"code"`
	ClientID            string    `json:"client_id"`
	UserID              string    `json:"user_id"`
	AgentID             string    `json:"agent_id"`
	AgentKind           string    `json:"agent_kind"`
	ClassID             string    `json:"class_id,omitempty"`
	CodeChallenge       string    `json:"code_challenge"`
	CodeChallengeMethod string    `json:"code_challenge_method"` // S256 or plain
	RedirectURI         string    `json:"redirect_uri"`
	Scope               string    `json:"scope"`
	CreatedAt           time.Time `json:"created_at"`
	ExpiresAt           time.Time `json:"expires_at"`
}

// ProtectedResourceMetadata represents RFC 9728 OAuth 2.0 Protected Resource Metadata.
type ProtectedResourceMetadata struct {
	Resource               string   `json:"resource"`
	AuthorizationServers   []string `json:"authorization_servers"`
	ScopesSupported        []string `json:"scopes_supported,omitempty"`
	BearerMethodsSupported []string `json:"bearer_methods_supported"`
}

// ErrorResponse represents an RFC 6749 OAuth Error Response.
type ErrorResponse struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description,omitempty"`
}

// AgentInstanceOption is an active agent instance selectable in the /authorize consent UI.
type AgentInstanceOption struct {
	ID        string `json:"id"`
	ClassName string `json:"class_name"`
}


