// Package metrics provides Prometheus instrumentation for the gateway.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// RequestDuration tracks total request latency from receive to response.
	RequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "request_duration_seconds",
		Help:      "Total request latency from gateway receive to response sent.",
		Buckets:   []float64{.001, .0025, .005, .01, .025, .05, .1, .25, .5, 1.0},
	}, []string{"tool", "agent_class", "decision"})

	// KillswitchDuration tracks kill-switch pipeline check latency.
	KillswitchDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "killswitch_check_seconds",
		Help:      "Time spent checking kill-switch flags in Redis.",
		Buckets:   []float64{.0001, .0005, .001, .005, .01},
	})

	// ConstraintCheckDuration tracks per-tool constraint evaluation latency.
	ConstraintCheckDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "constraint_check_seconds",
		Help:      "Time spent checking per-tool constraints.",
		Buckets:   []float64{.0001, .0005, .001, .005},
	}, []string{"tool"})

	// PolicyEvalDuration tracks OPA policy evaluation latency.
	PolicyEvalDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "policy_eval_seconds",
		Help:      "Time spent evaluating embedded OPA/Rego policies.",
		Buckets:   []float64{.0001, .0005, .001, .0025, .005, .01, .025},
	}, []string{"policy_name"})

	// SpendCheckDuration tracks Redis Lua spend cap check latency.
	SpendCheckDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "spend_check_seconds",
		Help:      "Time spent checking Redis Lua spend caps.",
		Buckets:   []float64{.0001, .0005, .001, .005, .01},
	})

	// DownstreamDuration tracks the hop time to downstream MCP/REST servers.
	DownstreamDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "downstream_hop_seconds",
		Help:      "Time spent waiting for downstream bank MCP/REST server response.",
		Buckets:   []float64{.005, .01, .025, .05, .1, .25, .5, 1.0, 2.5, 5.0},
	}, []string{"target_service", "tool"})

	// GovernanceOverhead tracks total governance pipeline overhead (excluding downstream hop).
	GovernanceOverhead = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "governance_overhead_seconds",
		Help:      "Total overhead added by governance pipeline (killswitch + constraint + policy + spend).",
		Buckets:   []float64{.0005, .001, .0025, .005, .01, .025, .05},
	}, []string{"tool", "decision"})

	// DecisionsTotal tracks authorization decision outcomes.
	DecisionsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "decisions_total",
		Help:      "Total authorization decisions by outcome and deny stage.",
	}, []string{"tool", "agent_class", "decision", "deny_stage"})

	// ActiveSessions tracks active MCP sessions.
	ActiveSessions = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "agp",
		Subsystem: "gateway",
		Name:      "active_sessions",
		Help:      "Number of currently active MCP sessions.",
	})
)
