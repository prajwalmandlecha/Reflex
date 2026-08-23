package oauth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

var (
	ErrClientNotFound       = errors.New("client not found")
	ErrInvalidSecret        = errors.New("invalid client secret")
	ErrRefreshTokenNotFound = errors.New("refresh token not found or expired")
	ErrAuthCodeNotFound     = errors.New("authorization code not found or expired")
)

// TokenStore defines the storage contract for OAuth clients, authorization codes, and refresh tokens.
type TokenStore interface {
	SaveClient(ctx context.Context, client *OAuthClient, ttl time.Duration) error
	GetClient(ctx context.Context, clientID string) (*OAuthClient, error)
	VerifyClientSecret(client *OAuthClient, rawSecret string) bool
	SaveAuthCode(ctx context.Context, rawCode string, record *AuthorizationCodeRecord, ttl time.Duration) error
	ConsumeAuthCode(ctx context.Context, rawCode string) (*AuthorizationCodeRecord, error)
	SaveRefreshToken(ctx context.Context, rawToken string, record *RefreshTokenRecord, ttl time.Duration) error
	GetRefreshToken(ctx context.Context, rawToken string) (*RefreshTokenRecord, error)
	ConsumeRefreshToken(ctx context.Context, rawToken string) (*RefreshTokenRecord, error)
	RevokeToken(ctx context.Context, rawToken string) error
}


// HashValue computes a SHA-256 hex string of a secret or token.
func HashValue(val string) string {
	sum := sha256.Sum256([]byte(val))
	return hex.EncodeToString(sum[:])
}

// RedisStore handles persistence and retrieval of OAuth clients and tokens in Redis.
type RedisStore struct {
	rdb *redis.Client
}

// NewRedisStore creates a new OAuth Redis store.
func NewRedisStore(rdb *redis.Client) *RedisStore {
	return &RedisStore{rdb: rdb}
}

// SaveClient stores an OAuth client in Redis under agp:oauth:client:{client_id}.
func (s *RedisStore) SaveClient(ctx context.Context, client *OAuthClient, ttl time.Duration) error {
	if s.rdb == nil {
		return errors.New("redis client is nil")
	}
	key := fmt.Sprintf("agp:oauth:client:%s", client.ClientID)
	data, err := json.Marshal(client)
	if err != nil {
		return fmt.Errorf("failed to marshal oauth client: %w", err)
	}

	return s.rdb.Set(ctx, key, string(data), ttl).Err()
}

// GetClient retrieves an OAuth client from Redis.
func (s *RedisStore) GetClient(ctx context.Context, clientID string) (*OAuthClient, error) {
	if s.rdb == nil {
		return nil, errors.New("redis client is nil")
	}
	key := fmt.Sprintf("agp:oauth:client:%s", clientID)
	data, err := s.rdb.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, ErrClientNotFound
	} else if err != nil {
		return nil, err
	}

	var client OAuthClient
	if err := json.Unmarshal([]byte(data), &client); err != nil {
		return nil, fmt.Errorf("failed to unmarshal oauth client: %w", err)
	}
	return &client, nil
}

// VerifyClientSecret verifies a plaintext client secret against the stored SHA-256 hash using constant-time comparison.
func (s *RedisStore) VerifyClientSecret(client *OAuthClient, rawSecret string) bool {
	if client == nil || client.ClientSecretHash == "" {
		return false
	}
	expectedHash := client.ClientSecretHash
	actualHash := HashValue(rawSecret)
	return hmac.Equal([]byte(expectedHash), []byte(actualHash))
}

// SaveAuthCode stores an authorization code record indexed by the code's SHA-256 hash.
func (s *RedisStore) SaveAuthCode(ctx context.Context, rawCode string, record *AuthorizationCodeRecord, ttl time.Duration) error {
	if s.rdb == nil {
		return errors.New("redis client is nil")
	}
	codeHash := HashValue(rawCode)
	key := fmt.Sprintf("agp:oauth:code:%s", codeHash)
	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("failed to marshal authorization code record: %w", err)
	}

	return s.rdb.Set(ctx, key, string(data), ttl).Err()
}

// ConsumeAuthCode retrieves the authorization code record and immediately deletes it to enforce single-use.
func (s *RedisStore) ConsumeAuthCode(ctx context.Context, rawCode string) (*AuthorizationCodeRecord, error) {
	if s.rdb == nil {
		return nil, errors.New("redis client is nil")
	}
	codeHash := HashValue(rawCode)
	key := fmt.Sprintf("agp:oauth:code:%s", codeHash)

	res, err := s.rdb.GetDel(ctx, key).Result()
	if err == redis.Nil || res == "" {
		return nil, ErrAuthCodeNotFound
	} else if err != nil {
		return nil, err
	}

	var record AuthorizationCodeRecord
	if err := json.Unmarshal([]byte(res), &record); err != nil {
		return nil, fmt.Errorf("failed to unmarshal authorization code record: %w", err)
	}
	return &record, nil
}

// SaveRefreshToken stores a refresh token record indexed by the token's SHA-256 hash.
func (s *RedisStore) SaveRefreshToken(ctx context.Context, rawToken string, record *RefreshTokenRecord, ttl time.Duration) error {
	if s.rdb == nil {
		return errors.New("redis client is nil")
	}
	tokenHash := HashValue(rawToken)
	key := fmt.Sprintf("agp:oauth:refresh:%s", tokenHash)
	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("failed to marshal refresh token record: %w", err)
	}

	return s.rdb.Set(ctx, key, string(data), ttl).Err()
}

// GetRefreshToken retrieves the record for a refresh token by hashing the raw token.
func (s *RedisStore) GetRefreshToken(ctx context.Context, rawToken string) (*RefreshTokenRecord, error) {
	if s.rdb == nil {
		return nil, errors.New("redis client is nil")
	}
	tokenHash := HashValue(rawToken)
	key := fmt.Sprintf("agp:oauth:refresh:%s", tokenHash)
	data, err := s.rdb.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, ErrRefreshTokenNotFound
	} else if err != nil {
		return nil, err
	}

	var record RefreshTokenRecord
	if err := json.Unmarshal([]byte(data), &record); err != nil {
		return nil, fmt.Errorf("failed to unmarshal refresh token record: %w", err)
	}
	return &record, nil
}

// ConsumeRefreshToken retrieves the record and immediately deletes it from Redis to enforce single-use token rotation.
func (s *RedisStore) ConsumeRefreshToken(ctx context.Context, rawToken string) (*RefreshTokenRecord, error) {
	if s.rdb == nil {
		return nil, errors.New("redis client is nil")
	}
	tokenHash := HashValue(rawToken)
	key := fmt.Sprintf("agp:oauth:refresh:%s", tokenHash)

	res, err := s.rdb.GetDel(ctx, key).Result()
	if err == redis.Nil || res == "" {
		return nil, ErrRefreshTokenNotFound
	} else if err != nil {
		return nil, err
	}

	var record RefreshTokenRecord
	if err := json.Unmarshal([]byte(res), &record); err != nil {
		return nil, fmt.Errorf("failed to unmarshal refresh token record: %w", err)
	}
	return &record, nil
}

// RevokeToken invalidates a token from Redis.
func (s *RedisStore) RevokeToken(ctx context.Context, rawToken string) error {
	if s.rdb == nil {
		return errors.New("redis client is nil")
	}
	tokenHash := HashValue(rawToken)
	key := fmt.Sprintf("agp:oauth:refresh:%s", tokenHash)
	return s.rdb.Del(ctx, key).Err()
}

// MemoryStore is an in-memory implementation of TokenStore for standalone unit testing and dev modes.
type MemoryStore struct {
	mu           sync.RWMutex
	clients      map[string]*OAuthClient
	codeMap      map[string]*AuthorizationCodeRecord
	codeExpAt    map[string]time.Time
	refreshMap   map[string]*RefreshTokenRecord
	refreshExpAt map[string]time.Time
}

// NewMemoryStore creates a new in-memory TokenStore.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		clients:      make(map[string]*OAuthClient),
		codeMap:      make(map[string]*AuthorizationCodeRecord),
		codeExpAt:    make(map[string]time.Time),
		refreshMap:   make(map[string]*RefreshTokenRecord),
		refreshExpAt: make(map[string]time.Time),
	}
}

func (m *MemoryStore) SaveClient(ctx context.Context, client *OAuthClient, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.clients[client.ClientID] = client
	return nil
}

func (m *MemoryStore) GetClient(ctx context.Context, clientID string) (*OAuthClient, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	c, ok := m.clients[clientID]
	if !ok {
		return nil, ErrClientNotFound
	}
	return c, nil
}

func (m *MemoryStore) VerifyClientSecret(client *OAuthClient, rawSecret string) bool {
	if client == nil || client.ClientSecretHash == "" {
		return false
	}
	expectedHash := client.ClientSecretHash
	actualHash := HashValue(rawSecret)
	return hmac.Equal([]byte(expectedHash), []byte(actualHash))
}

func (m *MemoryStore) SaveAuthCode(ctx context.Context, rawCode string, record *AuthorizationCodeRecord, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	codeHash := HashValue(rawCode)
	m.codeMap[codeHash] = record
	if ttl > 0 {
		m.codeExpAt[codeHash] = time.Now().Add(ttl)
	}
	return nil
}

func (m *MemoryStore) ConsumeAuthCode(ctx context.Context, rawCode string) (*AuthorizationCodeRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	codeHash := HashValue(rawCode)
	exp, hasExp := m.codeExpAt[codeHash]
	if hasExp && time.Now().After(exp) {
		delete(m.codeMap, codeHash)
		delete(m.codeExpAt, codeHash)
		return nil, ErrAuthCodeNotFound
	}
	rec, ok := m.codeMap[codeHash]
	if !ok {
		return nil, ErrAuthCodeNotFound
	}
	delete(m.codeMap, codeHash)
	delete(m.codeExpAt, codeHash)
	return rec, nil
}

func (m *MemoryStore) SaveRefreshToken(ctx context.Context, rawToken string, record *RefreshTokenRecord, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	tokenHash := HashValue(rawToken)
	m.refreshMap[tokenHash] = record
	if ttl > 0 {
		m.refreshExpAt[tokenHash] = time.Now().Add(ttl)
	}
	return nil
}

func (m *MemoryStore) GetRefreshToken(ctx context.Context, rawToken string) (*RefreshTokenRecord, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	tokenHash := HashValue(rawToken)
	exp, hasExp := m.refreshExpAt[tokenHash]
	if hasExp && time.Now().After(exp) {
		return nil, ErrRefreshTokenNotFound
	}
	rec, ok := m.refreshMap[tokenHash]
	if !ok {
		return nil, ErrRefreshTokenNotFound
	}
	return rec, nil
}

func (m *MemoryStore) ConsumeRefreshToken(ctx context.Context, rawToken string) (*RefreshTokenRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	tokenHash := HashValue(rawToken)
	exp, hasExp := m.refreshExpAt[tokenHash]
	if hasExp && time.Now().After(exp) {
		delete(m.refreshMap, tokenHash)
		delete(m.refreshExpAt, tokenHash)
		return nil, ErrRefreshTokenNotFound
	}
	rec, ok := m.refreshMap[tokenHash]
	if !ok {
		return nil, ErrRefreshTokenNotFound
	}
	delete(m.refreshMap, tokenHash)
	delete(m.refreshExpAt, tokenHash)
	return rec, nil
}

func (m *MemoryStore) RevokeToken(ctx context.Context, rawToken string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	tokenHash := HashValue(rawToken)
	delete(m.refreshMap, tokenHash)
	delete(m.refreshExpAt, tokenHash)
	return nil
}

