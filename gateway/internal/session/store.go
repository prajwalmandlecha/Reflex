// Package session provides Redis-backed MCP session management.
//
// On MCP initialize, a session ID is minted and stored in Redis.
// Any gateway replica can read it, enabling round-robin LB with no sticky sessions.
package session

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	keyPrefix  = "mcp:session:"
	defaultTTL = 24 * time.Hour
)

// Session represents an active MCP session.
type Session struct {
	ID           string    `json:"id"`
	AgentID      string    `json:"agent_id"`
	Capabilities []string  `json:"capabilities,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// Store manages MCP sessions in Redis.
type Store struct {
	rdb *redis.Client
	ttl time.Duration
}

// NewStore creates a session store backed by the given Redis client.
func NewStore(rdb *redis.Client) *Store {
	return &Store{
		rdb: rdb,
		ttl: defaultTTL,
	}
}

// Create mints a new session for the given agent and stores it in Redis.
func (s *Store) Create(ctx context.Context, agentID string, capabilities []string) (*Session, error) {
	sess := &Session{
		ID:           uuid.New().String(),
		AgentID:      agentID,
		Capabilities: capabilities,
		CreatedAt:    time.Now(),
	}

	data, err := json.Marshal(sess)
	if err != nil {
		return nil, fmt.Errorf("marshaling session: %w", err)
	}

	key := keyPrefix + sess.ID
	if err := s.rdb.Set(ctx, key, data, s.ttl).Err(); err != nil {
		return nil, fmt.Errorf("storing session: %w", err)
	}

	return sess, nil
}

// Get retrieves a session by ID.
func (s *Store) Get(ctx context.Context, sessionID string) (*Session, error) {
	key := keyPrefix + sessionID
	data, err := s.rdb.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, fmt.Errorf("session %s not found", sessionID)
	}
	if err != nil {
		return nil, fmt.Errorf("getting session: %w", err)
	}

	var sess Session
	if err := json.Unmarshal(data, &sess); err != nil {
		return nil, fmt.Errorf("unmarshaling session: %w", err)
	}

	return &sess, nil
}

// Delete removes a session.
func (s *Store) Delete(ctx context.Context, sessionID string) error {
	key := keyPrefix + sessionID
	return s.rdb.Del(ctx, key).Err()
}

// Touch extends the session TTL (call on activity to prevent expiration).
func (s *Store) Touch(ctx context.Context, sessionID string) error {
	key := keyPrefix + sessionID
	return s.rdb.Expire(ctx, key, s.ttl).Err()
}
