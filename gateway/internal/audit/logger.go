// Package audit provides a hash-chained audit log writer and integrity verifier.
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

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Entry represents a single audit log row with per-stage latency breakdown.
type Entry struct {
	ID                   int64          `json:"id,omitempty"`
	Timestamp            time.Time      `json:"ts"`
	AgentID              string         `json:"agent_id"`
	AgentClassID         string         `json:"agent_class_id"`
	Action               string         `json:"action"`
	BankConnectionID     string         `json:"bank_connection_id"`
	Params               map[string]any `json:"params"`
	Decision             string         `json:"decision"` // "allow" or "deny"
	DenyStage            string         `json:"deny_stage"` // "killswitch", "constraint", "policy", "spend"
	SpendDelta           int64          `json:"spend_delta"`
	Reason               string         `json:"reason"`
	TotalLatencyMs       float64        `json:"total_latency_ms"`
	KillswitchLatencyMs  float64        `json:"killswitch_latency_ms"`
	PolicyLatencyMs      float64        `json:"policy_latency_ms"`
	SpendCheckLatencyMs  float64        `json:"spend_check_latency_ms"`
	ConstraintLatencyMs  float64        `json:"constraint_latency_ms"`
	DownstreamLatencyMs  float64        `json:"downstream_latency_ms"`
	GovernanceOverheadMs float64        `json:"governance_overhead_ms"`
	PrevHash             string         `json:"prev_hash"`
	EntryHash            string         `json:"entry_hash"`
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

// NewLogger creates an audit logger.
func NewLogger(ctx context.Context, dbPool *pgxpool.Pool, logger *slog.Logger, batchSize int, flushEvery time.Duration) (*Logger, error) {
	l := &Logger{
		db:         dbPool,
		logger:     logger,
		ch:         make(chan *Entry, batchSize*4),
		batchSize:  batchSize,
		flushEvery: flushEvery,
		done:       make(chan struct{}),
	}

	// Fetch last entry hash from audit_log
	var lastHash string
	err := dbPool.QueryRow(ctx, "SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1").Scan(&lastHash)
	if err == nil {
		l.prevHash = lastHash
	}

	go l.flushLoop(ctx)

	return l, nil
}

// Log enqueues an audit entry for batch writing.
func (l *Logger) Log(entry *Entry) {
	entry.Timestamp = time.Now()

	l.mu.Lock()
	entry.PrevHash = l.prevHash
	entry.EntryHash = computeHash(l.prevHash, entry)
	l.prevHash = entry.EntryHash
	l.mu.Unlock()

	select {
	case l.ch <- entry:
	default:
		l.logger.Error("audit log channel full, dropping entry", "agent_id", entry.AgentID, "action", entry.Action)
	}
}

// Close drains remaining entries and waits for flush loop.
func (l *Logger) Close(_ context.Context) error {
	close(l.ch)
	<-l.done
	return nil
}

func (l *Logger) flushLoop(ctx context.Context) {
	defer close(l.done)

	batch := make([]*Entry, 0, l.batchSize)
	ticker := time.NewTicker(l.flushEvery)
	defer ticker.Stop()

	flush := func(reason string) {
		if len(batch) == 0 {
			return
		}
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
		paramsJSON, _ := json.Marshal(e.Params)
		b.Queue(
			`INSERT INTO audit_log (
				ts, agent_id, agent_class_id, action, bank_connection_id, params, decision, deny_stage, reason, spend_delta,
				total_latency_ms, killswitch_latency_ms, policy_latency_ms, spend_check_latency_ms, constraint_latency_ms,
				downstream_latency_ms, governance_overhead_ms, prev_hash, entry_hash
			) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
			e.Timestamp, e.AgentID, e.AgentClassID, e.Action, e.BankConnectionID, string(paramsJSON), e.Decision, e.DenyStage, e.Reason, e.SpendDelta,
			e.TotalLatencyMs, e.KillswitchLatencyMs, e.PolicyLatencyMs, e.SpendCheckLatencyMs, e.ConstraintLatencyMs,
			e.DownstreamLatencyMs, e.GovernanceOverheadMs, e.PrevHash, e.EntryHash,
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

type hashContent struct {
	Timestamp            time.Time `json:"ts"`
	AgentID              string    `json:"agent_id"`
	AgentClassID         string    `json:"agent_class_id"`
	Action               string    `json:"action"`
	Decision             string    `json:"decision"`
	DenyStage            string    `json:"deny_stage"`
	SpendDelta           int64     `json:"spend_delta"`
	GovernanceOverheadMs float64   `json:"governance_overhead_ms"`
	Reason               string    `json:"reason"`
}

func computeHash(prevHash string, entry *Entry) string {
	c := hashContent{
		Timestamp:            entry.Timestamp.Truncate(time.Microsecond).UTC(),
		AgentID:              entry.AgentID,
		AgentClassID:         entry.AgentClassID,
		Action:               entry.Action,
		Decision:             entry.Decision,
		DenyStage:            entry.DenyStage,
		SpendDelta:           entry.SpendDelta,
		GovernanceOverheadMs: entry.GovernanceOverheadMs,
		Reason:               entry.Reason,
	}

	contentJSON, _ := json.Marshal(c)
	h := sha256.New()
	h.Write([]byte(prevHash))
	h.Write(contentJSON)
	return hex.EncodeToString(h.Sum(nil))
}
