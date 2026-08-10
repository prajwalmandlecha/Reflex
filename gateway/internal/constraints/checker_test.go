package constraints

import (
	"testing"

	"github.com/agp/gateway/internal/configcache"
)

// TestRequiresAmount_OptionalMoneyFieldIsNotFailClosed verifies the fix for
// the optional-parameter false positive: a tool that declares an OPTIONAL money
// field (e.g. "scale" on estimate_agent_usage) must NOT fail closed when the
// call omits it. Only REQUIRED money fields (or an unknown schema) fail closed.
func TestRequiresAmount_OptionalMoneyFieldIsNotFailClosed(t *testing.T) {
	c := &Checker{}

	// Optional money field, schema known → NOT required → no fail-closed.
	cfg := &configcache.AgentConfig{
		EffectiveConstraints: map[string]map[string]any{
			"estimate_agent_usage": {"money_params": []any{"scale"}},
		},
		ToolSchemas: map[string]configcache.ToolSchema{
			"estimate_agent_usage": {Required: []string{"tables", "template", "prompt", "estimated_records"}},
		},
	}
	if required, _ := c.RequiresAmount(cfg, "estimate_agent_usage"); required {
		t.Fatalf("optional money field 'scale' must not fail closed, got required=true")
	}

	// Required money field, schema known → required → fail-closed.
	cfg2 := &configcache.AgentConfig{
		EffectiveConstraints: map[string]map[string]any{
			"transfer_money": {"money_params": []any{"amount_cents"}},
		},
		ToolSchemas: map[string]configcache.ToolSchema{
			"transfer_money": {Required: []string{"amount_cents", "dest_account"}},
		},
	}
	if required, _ := c.RequiresAmount(cfg2, "transfer_money"); !required {
		t.Fatalf("required money field 'amount_cents' must fail closed, got required=false")
	}

	// Unknown schema → conservative fail-closed.
	cfg3 := &configcache.AgentConfig{
		EffectiveConstraints: map[string]map[string]any{
			"transfer_money": {"money_params": []any{"amount_cents"}},
		},
		ToolSchemas: map[string]configcache.ToolSchema{},
	}
	if required, _ := c.RequiresAmount(cfg3, "transfer_money"); !required {
		t.Fatalf("unknown schema must fail closed conservatively, got required=false")
	}
}

// TestExtractAmountCents_MoneyParams verifies the declared-field extraction:
// _cents fields are taken as-is, non-_cents fields are major units (×100), and
// multiple declared fields are summed.
func TestExtractAmountCents_MoneyParams(t *testing.T) {
	cases := []struct {
		name        string
		args        map[string]any
		moneyParams []string
		wantCents   float64
		wantFound   bool
	}{
		{
			name:        "cents field taken verbatim",
			args:        map[string]any{"amount_cents": float64(120000)},
			moneyParams: []string{"amount_cents"},
			wantCents:   120000,
			wantFound:   true,
		},
		{
			name:        "major-unit field scaled by 100",
			args:        map[string]any{"attendee_share": float64(25)},
			moneyParams: []string{"attendee_share"},
			wantCents:   2500,
			wantFound:   true,
		},
		{
			name:        "multiple declared fields are summed",
			args:        map[string]any{"attendee_share": float64(25), "tip": float64(5)},
			moneyParams: []string{"attendee_share", "tip"},
			wantCents:   3000,
			wantFound:   true,
		},
		{
			name:        "string numbers parse",
			args:        map[string]any{"amount_cents": "5000"},
			moneyParams: []string{"amount_cents"},
			wantCents:   5000,
			wantFound:   true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cents, found := ExtractAmountCents(tc.args, tc.moneyParams)
			if cents != tc.wantCents || found != tc.wantFound {
				t.Fatalf("ExtractAmountCents(%v, %v) = (%v, %v), want (%v, %v)",
					tc.args, tc.moneyParams, cents, found, tc.wantCents, tc.wantFound)
			}
		})
	}
}

// TestExtractAmountCents_BypassIsClosed encodes the killer-demo bypass: a
// transfer that carries only dest_amount while the tool declares amount_cents
// as its money field must report found=false, so the gateway fails closed
// instead of metering $0 and letting $1M sail through the spend cap.
func TestExtractAmountCents_BypassIsClosed(t *testing.T) {
	args := map[string]any{"dest_amount": float64(1_000_000)}

	// Declared money field is amount_cents; dest_amount is NOT it.
	if cents, found := ExtractAmountCents(args, []string{"amount_cents"}); found || cents != 0 {
		t.Fatalf("undeclared money field should not be metered: got (%v, %v), want (0, false)", cents, found)
	}

	// Once dest_amount is declared, it is metered (as major units → cents).
	if cents, found := ExtractAmountCents(args, []string{"dest_amount"}); !found || cents != 100_000_000 {
		t.Fatalf("declared dest_amount should be metered: got (%v, %v), want (1e8, true)", cents, found)
	}
}

// TestExtractAmountCents_LegacyFallback verifies backward compatibility when a
// tool declares no money_params: amount_cents is cents, amount is major units,
// and an unrecognized-only payload reports not-found (fail-closed upstream).
func TestExtractAmountCents_LegacyFallback(t *testing.T) {
	if cents, found := ExtractAmountCents(map[string]any{"amount_cents": float64(7500)}, nil); !found || cents != 7500 {
		t.Fatalf("legacy amount_cents: got (%v, %v), want (7500, true)", cents, found)
	}
	if cents, found := ExtractAmountCents(map[string]any{"amount": float64(75)}, nil); !found || cents != 7500 {
		t.Fatalf("legacy amount: got (%v, %v), want (7500, true)", cents, found)
	}
	if cents, found := ExtractAmountCents(map[string]any{"dest_amount": float64(75)}, nil); found || cents != 0 {
		t.Fatalf("legacy fallback with unknown field: got (%v, %v), want (0, false)", cents, found)
	}
}
