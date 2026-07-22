// Package metrics provides Prometheus instrumentation for the gateway.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// DecisionLatency tracks the p50/p95/p99 of the full authorization pipeline.
	DecisionLatency = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "decision_latency_seconds",
		Help:      "Latency of the full authorization decision pipeline.",
		Buckets:   []float64{.0005, .001, .0025, .005, .01, .025, .05, .1, .25},
	})

	// DecisionsTotal counts decisions by outcome (allow/deny) and deny reason category.
	DecisionsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "decisions_total",
		Help:      "Total authorization decisions by outcome.",
	}, []string{"decision", "reason_category"})

	// SpendTotal tracks total spend amount processed.
	SpendTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "spend_total",
		Help:      "Total spend amount processed (in smallest currency unit).",
	}, []string{"agent_id", "category"})

	// KillSwitchActivations counts kill-switch triggered denials.
	KillSwitchActivations = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "killswitch_activations_total",
		Help:      "Total kill-switch triggered denials.",
	}, []string{"scope"}) // "fleet" or "agent"

	// ActiveSessions tracks currently active MCP sessions.
	ActiveSessions = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "active_sessions",
		Help:      "Number of currently active MCP sessions.",
	})

	// AuditEntriesWritten counts audit entries written to Postgres.
	AuditEntriesWritten = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "audit_entries_written_total",
		Help:      "Total audit entries written to the log.",
	})
)
