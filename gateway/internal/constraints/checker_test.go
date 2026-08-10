package constraints

import (
	"testing"

	"github.com/agp/gateway/internal/configcache"
	"github.com/agp/gateway/internal/spend"
)

// TestCheckParamMax verifies the per-call parameter ceiling: a declared param
// with a Max denies calls whose |value| exceeds it, and allows calls within it.
func TestCheckParamMax(t *testing.T) {
	c := &Checker{}

	cfg := &configcache.AgentConfig{
		EffectiveConstraints: map[string]map[string]any{
			"deposit_funds": {
				"params": map[string]any{
					"amount": map[string]any{"max": float64(5000)},
				},
			},
		},
	}

	// Within cap → allowed.
	if ok, reason := c.CheckParamMax(cfg, "deposit_funds", map[string]any{"amount": float64(1000)}); !ok {
		t.Fatalf("amount 1000 within cap 5000 should be allowed, got deny: %s", reason)
	}

	// At cap → allowed (<=).
	if ok, _ := c.CheckParamMax(cfg, "deposit_funds", map[string]any{"amount": float64(5000)}); !ok {
		t.Fatalf("amount 5000 at cap should be allowed")
	}

	// Over cap → denied.
	if ok, _ := c.CheckParamMax(cfg, "deposit_funds", map[string]any{"amount": float64(5001)}); ok {
		t.Fatalf("amount 5001 over cap 5000 should be denied")
	}

	// Negative value uses absolute → denied when |value| exceeds cap.
	if ok, _ := c.CheckParamMax(cfg, "deposit_funds", map[string]any{"amount": float64(-6000)}); ok {
		t.Fatalf("amount -6000 (abs 6000) over cap should be denied")
	}

	// Absent optional param → no ceiling to enforce → allowed.
	if ok, _ := c.CheckParamMax(cfg, "deposit_funds", map[string]any{}); !ok {
		t.Fatalf("absent param should be allowed")
	}

	// No rules configured → allowed.
	if ok, _ := c.CheckParamMax(cfg, "other_tool", map[string]any{"amount": float64(999999)}); !ok {
		t.Fatalf("tool with no param rules should be allowed")
	}
}

// TestParamCounterEntries verifies per-param daily/hourly accumulation counters
// are keyed by tool+param+window and carry the correct amount (absolute cents).
func TestParamCounterEntries(t *testing.T) {
	c := &Checker{}

	cfg := &configcache.AgentConfig{
		ID: "agent-1",
		EffectiveConstraints: map[string]map[string]any{
			"deposit_funds": {
				"params": map[string]any{
					"amount": map[string]any{"daily_cents": float64(500000), "hourly_cents": float64(100000)},
				},
			},
		},
	}

	entries := c.ParamCounterEntries(cfg, "deposit_funds", map[string]any{"amount": float64(1000)})
	// 1000 major units → 100000 cents. Expect one daily + one hourly entry.
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries (daily+hourly), got %d", len(entries))
	}

	var daily, hourly *spend.Entry
	for i := range entries {
		e := &entries[i]
		if e.Amount != 100000 {
			t.Fatalf("entry amount = %v, want 100000", e.Amount)
		}
		if e.Cap == 500000 {
			daily = e
		}
		if e.Cap == 100000 {
			hourly = e
		}
	}
	if daily == nil {
		t.Fatalf("missing daily entry")
	}
	if hourly == nil {
		t.Fatalf("missing hourly entry")
	}
}

// TestExtractAmountCents verifies the legacy amount/amount_cents extraction:
// amount_cents is cents, amount is major units (×100), and an unrecognized-only
// payload reports not-found.
func TestExtractAmountCents(t *testing.T) {
	if cents, found := ExtractAmountCents(map[string]any{"amount_cents": float64(7500)}); !found || cents != 7500 {
		t.Fatalf("amount_cents: got (%v, %v), want (7500, true)", cents, found)
	}
	if cents, found := ExtractAmountCents(map[string]any{"amount": float64(75)}); !found || cents != 7500 {
		t.Fatalf("amount: got (%v, %v), want (7500, true)", cents, found)
	}
	if cents, found := ExtractAmountCents(map[string]any{"dest_amount": float64(75)}); found || cents != 0 {
		t.Fatalf("unknown field: got (%v, %v), want (0, false)", cents, found)
	}
	if cents, found := ExtractAmountCents(nil); found || cents != 0 {
		t.Fatalf("nil args: got (%v, %v), want (0, false)", cents, found)
	}
}

