package audit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
// Returns the result with the first broken link (if any).
func Verify(ctx context.Context, db *pgxpool.Pool) (*VerifyResult, error) {
	rows, err := db.Query(ctx,
		`SELECT id, ts, agent_id, action, resource, decision, spend_delta, latency_ms, reason, prev_hash, entry_hash
		 FROM audit_log ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("querying audit log: %w", err)
	}
	defer rows.Close()

	result := &VerifyResult{Valid: true}
	var prevHash string

	for rows.Next() {
		var (
			id         int64
			ts         time.Time
			agentID    string
			action     string
			resource   string
			decision   string
			spendDelta int64
			latencyMs  float64
			reason     string
			rowPrev    string
			rowHash    string
		)

		if err := rows.Scan(&id, &ts, &agentID, &action, &resource, &decision,
			&spendDelta, &latencyMs, &reason, &rowPrev, &rowHash); err != nil {
			return nil, fmt.Errorf("scanning row %d: %w", id, err)
		}

		result.TotalEntries++

		// Check that prev_hash matches what we expect.
		if rowPrev != prevHash {
			result.Valid = false
			result.BrokenAt = &id
			result.Error = fmt.Sprintf("entry %d: prev_hash mismatch (expected %s, got %s)", id, prevHash, rowPrev)
			return result, nil
		}

		// Recompute the hash using the same hashContent type as the writer.
		c := hashContent{
			Timestamp:  ts.Truncate(time.Microsecond).UTC(),
			AgentID:    agentID,
			Action:     action,
			Resource:   resource,
			Decision:   decision,
			SpendDelta: spendDelta,
			LatencyMs:  latencyMs,
			Reason:     reason,
		}

		contentJSON, _ := json.Marshal(c)
		h := sha256.New()
		h.Write([]byte(prevHash))
		h.Write(contentJSON)
		expectedHash := hex.EncodeToString(h.Sum(nil))

		if rowHash != expectedHash {
			result.Valid = false
			result.BrokenAt = &id
			result.Error = fmt.Sprintf("entry %d: hash mismatch (expected %s, got %s)", id, expectedHash, rowHash)
			return result, nil
		}

		prevHash = rowHash
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating audit log: %w", err)
	}

	return result, nil
}
