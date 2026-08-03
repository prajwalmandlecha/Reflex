package constraints

import "testing"

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
