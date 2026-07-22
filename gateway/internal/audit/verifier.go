package audit

import (
	"context"
	"fmt"
	"time"

	"github.com/agp/gateway/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VerifyResult holds the outcome of an audit chain integrity check.
type VerifyResult struct {
	Valid        bool   `json:"valid"`
	TotalEntries int    `json:"total_entries"`
	BrokenAt     *int64 `json:"broken_at,omitempty"`
	Error        string `json:"error,omitempty"`
}

// Verify reads the entire audit log via sqlc and checks the hash chain integrity.
func Verify(ctx context.Context, pool *pgxpool.Pool) (*VerifyResult, error) {
	queries := db.New(pool)
	rows, err := queries.ListAuditLogs(ctx)
	if err != nil {
		return nil, fmt.Errorf("querying audit log via sqlc: %w", err)
	}

	result := &VerifyResult{Valid: true}
	var prevHash string

	for _, row := range rows {
		result.TotalEntries++

		// Check that prev_hash matches what we expect.
		if row.PrevHash != prevHash {
			result.Valid = false
			result.BrokenAt = &row.ID
			result.Error = fmt.Sprintf("row %d: prev_hash mismatch (got %s, expected %s)", row.ID, row.PrevHash, prevHash)
			return result, nil
		}

		// Recompute entry_hash.
		entry := &Entry{
			Timestamp:  row.Ts.Truncate(time.Microsecond).UTC(),
			AgentID:    row.AgentID,
			Action:     row.Action,
			Resource:   row.Resource,
			Decision:   row.Decision,
			SpendDelta: row.SpendDelta,
			LatencyMs:  row.LatencyMs,
			Reason:     row.Reason,
		}

		expectedHash := computeHash(prevHash, entry)
		if row.EntryHash != expectedHash {
			result.Valid = false
			result.BrokenAt = &row.ID
			result.Error = fmt.Sprintf("row %d: entry_hash mismatch (got %s, computed %s)", row.ID, row.EntryHash, expectedHash)
			return result, nil
		}

		prevHash = row.EntryHash
	}

	return result, nil
}
