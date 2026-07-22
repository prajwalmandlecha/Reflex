// Package audit provides a hash-chained audit log writer and integrity verifier.
//
// Every audit row is hash-chained to the previous one:
//
//	entry_hash = SHA-256(prev_hash || json(row_content))
//
// Writes are batched off the hot path (buffered channel, flushed every N rows or T milliseconds).
package audit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/agp/gateway/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Entry represents a single audit log row.
type Entry struct {
	ID         int64     `json:"id,omitempty"`
	Timestamp  time.Time `json:"ts"`
	AgentID    string    `json:"agent_id"`
	Action     string    `json:"action"`
	Resource   string    `json:"resource"`
	Decision   string    `json:"decision"` // "allow" or "deny"
	PolicyID   *int64    `json:"policy_id,omitempty"`
	SpendDelta int64     `json:"spend_delta"`
	LatencyMs  float64   `json:"latency_ms"`
	Reason     string    `json:"reason,omitempty"`
	PrevHash   string    `json:"prev_hash"`
	EntryHash  string    `json:"entry_hash"`
}

// Logger writes hash-chained audit entries to Postgres in batches.
type Logger struct {
	db         *pgxpool.Pool
	logger     *slog.Logger
	ch         chan *Entry
	batchSize  int
	flushEvery time.Duration

	mu       sync.Mutex
	prevHash string

	done chan struct{}
}

// NewLogger creates an audit logger. It starts a background goroutine that flushes
// entries in batches.
func NewLogger(ctx context.Context, dbPool *pgxpool.Pool, logger *slog.Logger, batchSize int, flushEvery time.Duration) (*Logger, error) {
	l := &Logger{
		db:         dbPool,
		logger:     logger,
		ch:         make(chan *Entry, batchSize*4),
		batchSize:  batchSize,
		flushEvery: flushEvery,
		done:       make(chan struct{}),
	}

	// Load the last hash from Postgres via sqlc to continue the chain.
	queries := db.New(dbPool)
	lastEntry, err := queries.GetLastAuditLog(ctx)
	if err == nil {
		l.prevHash = lastEntry.EntryHash
	}

	go l.flushLoop(ctx)

	return l, nil
}

// Log enqueues an audit entry for batch writing. Non-blocking: drops the entry
// and logs an error if the internal buffer is full.
func (l *Logger) Log(entry *Entry) {
	entry.Timestamp = time.Now()

	// Compute hash chain under lock — serialises the chain ordering.
	l.mu.Lock()
	entry.PrevHash = l.prevHash
	entry.EntryHash = computeHash(l.prevHash, entry)
	l.prevHash = entry.EntryHash
	l.mu.Unlock()

	select {
	case l.ch <- entry:
	default:
		l.logger.Error("audit log channel full, dropping entry",
			"agent_id", entry.AgentID,
			"action", entry.Action,
		)
	}
}

// Close signals the flush loop to drain remaining entries and waits for it to finish.
func (l *Logger) Close(_ context.Context) error {
	close(l.ch)
	<-l.done
	return nil
}

// flushLoop runs in a dedicated goroutine. It collects entries from the channel
// and writes them to Postgres in batches.
func (l *Logger) flushLoop(ctx context.Context) {
	defer close(l.done)

	batch := make([]*Entry, 0, l.batchSize)
	ticker := time.NewTicker(l.flushEvery)
	defer ticker.Stop()

	flush := func(reason string) {
		if len(batch) == 0 {
			return
		}
		// On context cancellation, use a short-lived context for the final write.
		writeCtx := ctx
		if ctx.Err() != nil {
			var cancel context.CancelFunc
			writeCtx, cancel = context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
		}
		if err := l.writeBatch(writeCtx, batch); err != nil {
			l.logger.Error("failed to flush audit batch", "reason", reason, "error", err)
		}
		batch = batch[:0]
	}

	for {
		select {
		case entry, ok := <-l.ch:
			if !ok {
				// Channel closed — flush remaining and exit.
				flush("channel_closed")
				return
			}
			batch = append(batch, entry)
			if len(batch) >= l.batchSize {
				flush("batch_full")
			}

		case <-ticker.C:
			flush("timer")

		case <-ctx.Done():
			flush("shutdown")
			return
		}
	}
}

func (l *Logger) writeBatch(ctx context.Context, entries []*Entry) error {
	b := &pgx.Batch{}
	for _, e := range entries {
		b.Queue(
			`INSERT INTO audit_log (ts, agent_id, action, resource, decision, spend_delta, latency_ms, reason, prev_hash, entry_hash)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			e.Timestamp, e.AgentID, e.Action, e.Resource, e.Decision,
			e.SpendDelta, e.LatencyMs, e.Reason, e.PrevHash, e.EntryHash,
		)
	}

	br := l.db.SendBatch(ctx, b)
	defer br.Close()

	for i := range entries {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("inserting audit entry %d: %w", i, err)
		}
	}

	l.logger.Debug("flushed audit batch", "count", len(entries))
	return nil
}

// hashContent is the subset of Entry fields included in the hash chain.
// Kept as a named type so the hash computation in logger.go and verifier.go
// stays in sync via a single definition.
type hashContent struct {
	Timestamp  time.Time `json:"ts"`
	AgentID    string    `json:"agent_id"`
	Action     string    `json:"action"`
	Resource   string    `json:"resource"`
	Decision   string    `json:"decision"`
	SpendDelta int64     `json:"spend_delta"`
	LatencyMs  float64   `json:"latency_ms"`
	Reason     string    `json:"reason"`
}

// computeHash generates the hash-chain value: SHA-256(prevHash || json(entry_content)).
func computeHash(prevHash string, entry *Entry) string {
	c := hashContent{
		Timestamp:  entry.Timestamp.Truncate(time.Microsecond).UTC(),
		AgentID:    entry.AgentID,
		Action:     entry.Action,
		Resource:   entry.Resource,
		Decision:   entry.Decision,
		SpendDelta: entry.SpendDelta,
		LatencyMs:  entry.LatencyMs,
		Reason:     entry.Reason,
	}

	contentJSON, err := json.Marshal(c)
	if err != nil {
		// Should never happen with these field types, but don't silently swallow it.
		panic(fmt.Sprintf("audit: failed to marshal hash content: %v", err))
	}
	h := sha256.New()
	h.Write([]byte(prevHash))
	h.Write(contentJSON)
	return hex.EncodeToString(h.Sum(nil))
}
