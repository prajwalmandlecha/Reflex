// Package authn provides JWT minting and validation for agent identity.
package authn

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// AgentClaims are the JWT claims carried by every agent request.
type AgentClaims struct {
	jwt.RegisteredClaims
	AgentID       string `json:"agent_id"`
	AgentKind     string `json:"agent_kind"`
	PolicyVersion int    `json:"policy_version"`
}

// JWTManager mints and validates agent JWTs.
type JWTManager struct {
	secret []byte
	issuer string
	ttl    time.Duration
}

// NewJWTManager creates a JWTManager with the given HMAC secret, issuer, and default TTL.
func NewJWTManager(secret, issuer string, ttl time.Duration) *JWTManager {
	return &JWTManager{
		secret: []byte(secret),
		issuer: issuer,
		ttl:    ttl,
	}
}

// Mint creates a signed JWT for the given agent using the default TTL.
func (m *JWTManager) Mint(agentID, agentKind string, policyVersion int) (string, error) {
	return m.MintWithTTL(agentID, agentKind, policyVersion, m.ttl)
}

// MintWithTTL creates a signed JWT for the given agent with an explicit TTL.
func (m *JWTManager) MintWithTTL(agentID, agentKind string, policyVersion int, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := AgentClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    m.issuer,
			Subject:   agentID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
		AgentID:       agentID,
		AgentKind:     agentKind,
		PolicyVersion: policyVersion,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
}

// TTL returns the configured default TTL.
func (m *JWTManager) TTL() time.Duration {
	return m.ttl
}

// Validate parses and validates a JWT string, returning the agent claims.
func (m *JWTManager) Validate(tokenString string) (*AgentClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &AgentClaims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	claims, ok := token.Claims.(*AgentClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	// Bind the token to this issuer: a token minted by a different service that
	// happens to share the HMAC secret must not be accepted at the data plane.
	if m.issuer != "" && claims.Issuer != m.issuer {
		return nil, fmt.Errorf("invalid token issuer: got %q, want %q", claims.Issuer, m.issuer)
	}

	return claims, nil
}

// UserSessionClaims represents a logged-in dashboard user's session JWT claims.
type UserSessionClaims struct {
	jwt.RegisteredClaims
	Email    string `json:"email"`
	Role     string `json:"role"`
	FullName string `json:"full_name"`
	Type     string `json:"type"`
}

// ValidateUserSession parses and validates a platform user's session JWT token.
func (m *JWTManager) ValidateUserSession(tokenString string) (*UserSessionClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &UserSessionClaims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil {
		return nil, fmt.Errorf("invalid user session token: %w", err)
	}

	claims, ok := token.Claims.(*UserSessionClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid user session claims")
	}

	return claims, nil
}

