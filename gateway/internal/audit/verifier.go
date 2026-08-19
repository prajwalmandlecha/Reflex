package audit

import (
	"context"
	"encoding/json"
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

// Verify reads the entire audit log and checks the hash chain integrity.
func Verify(ctx context.Context, pool *pgxpool.Pool) (*VerifyResult, error) {
	q := db.New(pool)
	rows, err := q.ListAuditLogForVerify(ctx)
	if err != nil {
		return nil, fmt.Errorf("querying audit log: %w", err)
	}

	result := &VerifyResult{Valid: true}
	var prevHash string

	for _, row := range rows {
		id := row.ID
		ts := row.Ts
		agentID := row.AgentID
		agentClassID := row.AgentClassID.String
		action := row.Action
		decision := row.Decision
		denyStage := row.DenyStage.String
		reason := row.Reason.String
		rowPrevHash := row.PrevHash.String
		entryHash := row.EntryHash
		govOverhead := row.GovernanceOverheadMs.Float64

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
			GovernanceOverheadMs: govOverhead,
			Reason:               reason,
		}

		// Params and response_data are stored as JSONB ([]byte). Unmarshal them
		// back into the Entry so computeHash hashes the same JSON the writer
		// produced. A nil/empty column hashes as nil, matching the writer's
		// nil Params/ResponseData on the same path.
		if len(row.Params) > 0 {
			var params map[string]any
			if err := json.Unmarshal(row.Params, &params); err == nil {
				entry.Params = params
			}
		}
		if len(row.ResponseData) > 0 {
			var resp any
			if err := json.Unmarshal(row.ResponseData, &resp); err == nil {
				entry.ResponseData = resp
			}
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
