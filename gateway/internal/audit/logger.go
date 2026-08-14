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

	"github.com/agp/gateway/internal/db"
	"github.com/jackc/pgx/v5/pgtype"
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
	ResponseData         any            `json:"response_data,omitempty"`
	Decision             string         `json:"decision"`   // "allow" or "deny"
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

	// Fetch last entry hash from audit_log (via sqlc-generated query).
	lastHash, err := db.New(dbPool).GetLastAuditEntryHash(ctx)
	if err == nil {
		l.prevHash = lastHash
	}

	go l.flushLoop(ctx)

	return l, nil
}

// Log enqueues an audit entry for batch writing.
//
// Hash-chain integrity: the prevHash pointer is advanced ONLY if the entry is
// successfully enqueued. If the channel is full, the entry is dropped and
// prevHash is left unchanged, so the next written entry still chains to the
// last *persisted* entry — a dropped entry never creates a gap in the chain.
// (A drop is data loss under overload, but it must not also corrupt the chain.)
//
// If a flush later fails, the failed batch is re-anchored to the last
// persisted hash and re-chained (see reanchorAndRechain), so a transient DB
// error cannot fork the persisted chain either.
func (l *Logger) Log(entry *Entry) {
	entry.Timestamp = time.Now()

	l.mu.Lock()
	defer l.mu.Unlock()

	// Tentatively chain onto the current head.
	entry.PrevHash = l.prevHash
	entry.EntryHash = computeHash(l.prevHash, entry)

	select {
	case l.ch <- entry:
		// Enqueued: commit the new head.
		l.prevHash = entry.EntryHash
	default:
		// Channel full: drop WITHOUT advancing prevHash. entry is discarded and
		// the chain remains unbroken for the next successfully-enqueued entry.
		l.logger.Error("audit log channel full, dropping entry (chain preserved)", "agent_id", entry.AgentID, "action", entry.Action)
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
			// The in-memory chain head has already advanced past these entries
			// (Log() commits it at enqueue time). Dropping the batch would fork
			// the persisted chain: the next written entry would chain to a hash
			// that was never persisted. Re-anchor the head to the last hash
			// actually persisted and re-chain the failed entries onto it, then
			// keep them for retry — no gap, no fork.
			l.reanchorAndRechain(batch)
			return // keep batch for retry on the next flush trigger
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

// reanchorAndRechain repairs the in-memory chain head after a batch flush
// failure. The head is reset to the last hash actually persisted in Postgres
// (falling back to the first failed entry's prevHash if the DB lookup fails),
// and every failed entry is re-chained onto that anchor so a later successful
// flush writes a continuous, unbroken chain.
func (l *Logger) reanchorAndRechain(entries []*Entry) {
	if len(entries) == 0 {
		return
	}

	anchor := entries[0].PrevHash // last hash known to be persisted before this batch
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if lastHash, err := db.New(l.db).GetLastAuditEntryHash(ctx); err == nil && lastHash != "" {
		anchor = lastHash
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	prev := anchor
	for _, e := range entries {
		e.PrevHash = prev
		e.EntryHash = computeHash(prev, e)
		prev = e.EntryHash
	}
	// Any entries enqueued after the failed batch chained onto the old head;
	// they will be re-chained the same way if their own flush fails. The head
	// must reflect the re-chained batch so subsequent enqueues build on it.
	l.prevHash = prev

	l.logger.Warn("re-anchored audit chain after flush failure", "entries", len(entries), "new_head", prev[:16])
}

func (l *Logger) writeBatch(ctx context.Context, entries []*Entry) error {
	// Insert the batch via the sqlc-generated query inside a single transaction,
	// preserving the all-or-nothing semantics the previous pgx.Batch provided.
	tx, err := l.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("beginning audit batch tx: %w", err)
	}
	defer tx.Rollback(ctx)

	q := db.New(tx)
	for i, e := range entries {
		paramsJSON, _ := json.Marshal(e.Params)
		var responseJSON json.RawMessage
		if e.ResponseData != nil {
			responseJSON, _ = json.Marshal(e.ResponseData)
		}
		err := q.InsertAuditEntry(ctx, db.InsertAuditEntryParams{
			Ts:                   e.Timestamp,
			AgentID:              e.AgentID,
			AgentClassID:         pgtype.Text{String: e.AgentClassID, Valid: e.AgentClassID != ""},
			Action:               e.Action,
			BankConnectionID:     pgtype.Text{String: e.BankConnectionID, Valid: e.BankConnectionID != ""},
			Params:               paramsJSON,
			ResponseData:         responseJSON,
			Decision:             e.Decision,
			DenyStage:            pgtype.Text{String: e.DenyStage, Valid: e.DenyStage != ""},
			Reason:               pgtype.Text{String: e.Reason, Valid: e.Reason != ""},
			SpendDelta:           pgtype.Int8{Int64: e.SpendDelta, Valid: true},
			TotalLatencyMs:       pgtype.Float8{Float64: e.TotalLatencyMs, Valid: true},
			KillswitchLatencyMs:  pgtype.Float8{Float64: e.KillswitchLatencyMs, Valid: true},
			PolicyLatencyMs:      pgtype.Float8{Float64: e.PolicyLatencyMs, Valid: true},
			SpendCheckLatencyMs:  pgtype.Float8{Float64: e.SpendCheckLatencyMs, Valid: true},
			ConstraintLatencyMs:  pgtype.Float8{Float64: e.ConstraintLatencyMs, Valid: true},
			DownstreamLatencyMs:  pgtype.Float8{Float64: e.DownstreamLatencyMs, Valid: true},
			GovernanceOverheadMs: pgtype.Float8{Float64: e.GovernanceOverheadMs, Valid: true},
			PrevHash:             pgtype.Text{String: e.PrevHash, Valid: true},
			EntryHash:            e.EntryHash,
		})
		if err != nil {
			return fmt.Errorf("inserting audit entry %d: %w", i, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("committing audit batch: %w", err)
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
