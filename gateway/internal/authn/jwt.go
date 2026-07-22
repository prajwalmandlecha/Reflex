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

// Mint creates a signed JWT for the given agent.
func (m *JWTManager) Mint(agentID, agentKind string, policyVersion int) (string, error) {
	now := time.Now()
	claims := AgentClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    m.issuer,
			Subject:   agentID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(m.ttl)),
		},
		AgentID:       agentID,
		AgentKind:     agentKind,
		PolicyVersion: policyVersion,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
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

	return claims, nil
}
