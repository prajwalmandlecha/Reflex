package audit

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// VerifyResult holds the outcome of an audit chain integrity check.
type VerifyResult struct {
	Valid        bool   `json:"valid"`
	TotalEntries int    `json:"total_entries"`
	BrokenAt     *int64 `json:"broken_at,omitempty"`
	Error        string `json:"error,omitempty"`
}

// Verify reads the entire audit log and checks the hash chain integrity.
func Verify(ctx context.Context, pool *pgxpool.Pool) (*VerifyResult, error) {
	rows, err := pool.Query(ctx, "SELECT id, ts, agent_id, agent_class_id, action, decision, deny_stage, spend_delta, governance_overhead_ms, reason, prev_hash, entry_hash FROM audit_log ORDER BY id ASC")
	if err != nil {
		return nil, fmt.Errorf("querying audit log: %w", err)
	}
	defer rows.Close()

	result := &VerifyResult{Valid: true}
	var prevHash string

	for rows.Next() {
		var id int64
		var ts time.Time
		var agentID, agentClassID, action, decision, denyStage, reason, rowPrevHash, entryHash string
		var spendDelta int64
		var govOverhead float64

		if err := rows.Scan(&id, &ts, &agentID, &agentClassID, &action, &decision, &denyStage, &spendDelta, &govOverhead, &reason, &rowPrevHash, &entryHash); err != nil {
			return nil, fmt.Errorf("scanning audit row: %w", err)
		}

		result.TotalEntries++

		if rowPrevHash != prevHash {
			result.Valid = false
			result.BrokenAt = &id
			result.Error = fmt.Sprintf("row %d: prev_hash mismatch (got %s, expected %s)", id, rowPrevHash, prevHash)
			return result, nil
		}

		entry := &Entry{
			Timestamp:            ts.Truncate(time.Microsecond).UTC(),
			AgentID:              agentID,
			AgentClassID:         agentClassID,
			Action:               action,
			Decision:             decision,
			DenyStage:            denyStage,
			SpendDelta:           spendDelta,
			GovernanceOverheadMs: govOverhead,
			Reason:               reason,
		}

		expectedHash := computeHash(prevHash, entry)
		if entryHash != expectedHash {
			result.Valid = false
			result.BrokenAt = &id
			result.Error = fmt.Sprintf("row %d: entry_hash mismatch (got %s, computed %s)", id, entryHash, expectedHash)
			return result, nil
		}

		prevHash = entryHash
	}

	return result, nil
}
