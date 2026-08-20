'use client';

import React, { useEffect, useState } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { api } from '@/lib/api';
import type { MetricsSnapshot } from '@/lib/types';
import { LatencyBreakdownBar } from '@/components/gov/latency-breakdown';
import { LiveMetricsPanel } from '@/components/gov/live-metrics-panel';
import { OverheadGauge } from '@/components/gov/overhead-gauge';

export function PerformanceView() {
  const { data: wsMetrics, isConnected } = useWebSocket<MetricsSnapshot>('/ws/metrics');
  const [initialMetrics, setInitialMetrics] = useState<MetricsSnapshot | null>(null);

  useEffect(() => {
    api.getMetricsSnapshot().then(setInitialMetrics).catch(() => {});
  }, []);

  const currentMetrics = wsMetrics || initialMetrics;
  const p = currentMetrics?.latency_percentiles || {};

  const totalP50 = p['total_ms']?.p50 || 0;
  const overheadP50 = p['governance_overhead_ms']?.p50 || 0;
  const downstreamP50 = p['downstream_ms']?.p50 || 0;
  const ksP50 = p['killswitch_ms']?.p50 || 0;
  const constP50 = p['constraint_ms']?.p50 || 0;
  const policyP50 = p['policy_ms']?.p50 || 0;
  const spendP50 = p['spend_ms']?.p50 || 0;

  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-mono text-sm uppercase tracking-widest text-ink-primary font-bold">
            Performance & Latency Instrumentation
          </h1>
          <p className="font-sans text-xs text-ink-secondary mt-0.5">
            Real-time per-stage governance overhead tracking, latency breakdown, and P95/P99 metrics.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="border border-white/[0.06] bg-slate-900 px-3 py-1.5 font-mono text-xs text-ink-secondary">
            Requests/sec: <strong className="text-emerald-400 font-semibold">{(currentMetrics?.requests_per_second || 0).toFixed(1)}</strong>
          </div>
          <div className="border border-white/[0.06] bg-slate-900 px-3 py-1.5 font-mono text-xs text-ink-secondary">
            Window: <strong className="text-accent font-semibold">{currentMetrics?.window_seconds || 300}s</strong>
          </div>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-slate-900/80 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Total Requests</p>
          <p className="mt-1 font-mono text-2xl font-bold text-white">
            {currentMetrics?.total_requests || 0}
          </p>
          <div className="mt-2 flex items-center gap-3 font-mono text-[11px]">
            <span className="text-emerald-400">Allow: {currentMetrics?.allow_count || 0}</span>
            <span className="text-rose-400">Deny: {currentMetrics?.deny_count || 0}</span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-slate-900/80 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Governance Overhead (p50)</p>
          <p className="mt-1 font-mono text-2xl font-bold text-amber-400">
            {overheadP50.toFixed(2)}ms
          </p>
          <p className="mt-2 font-mono text-[10px] text-ink-secondary/70">
            Killswitch + Constraint + OPA + Spend
          </p>
        </div>

        <div className="rounded-lg border border-border bg-slate-900/80 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Downstream Bank Hop (p50)</p>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">
            {downstreamP50.toFixed(2)}ms
          </p>
          <p className="mt-2 font-mono text-[10px] text-ink-secondary/70">
            Bank MCP / REST Target Latency
          </p>
        </div>

        <div className="rounded-lg border border-border bg-slate-900/80 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Total Request Time (p50)</p>
          <p className="mt-1 font-mono text-2xl font-bold text-accent">
            {totalP50.toFixed(2)}ms
          </p>
          <p className="mt-2 font-mono text-[10px] text-ink-secondary/70">
            End-to-End Interceptor Latency
          </p>
        </div>
      </div>

      {/* Main Grid: Gauge + Stacked Bar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <OverheadGauge overheadMs={overheadP50} totalMs={totalP50} />
        </div>

        <div className="lg:col-span-2 rounded-lg border border-border bg-slate-900/80 p-5 flex flex-col justify-between">
          <div>
            <h3 className="font-mono text-xs uppercase tracking-widest font-semibold text-white mb-1">
              Median Latency Stacked Breakdown
            </h3>
            <p className="font-sans text-xs text-ink-secondary mb-4">
              Relative time spent in each governance layer versus the downstream target response.
            </p>
            <LatencyBreakdownBar
              killswitchMs={ksP50}
              constraintMs={constP50}
              policyMs={policyP50}
              spendMs={spendP50}
              downstreamMs={downstreamP50}
              totalMs={totalP50}
            />
          </div>

          <div className="mt-6 pt-4 border-t border-white/[0.06] grid grid-cols-2 gap-4 font-mono text-xs">
            <div>
              <span className="text-ink-secondary uppercase tracking-widest text-[10px]">Denials by Stage:</span>
              <div className="mt-2 space-y-1">
                {Object.entries(currentMetrics?.deny_by_stage || {}).map(([st, cnt]) => (
                  <div key={st} className="flex justify-between text-ink-primary">
                    <span className="capitalize">{st || 'other'}:</span>
                    <strong className="text-rose-400 font-bold">{cnt}</strong>
                  </div>
                ))}
                {Object.keys(currentMetrics?.deny_by_stage || {}).length === 0 && (
                  <span className="text-ink-secondary/60 text-[11px] block">No denials in current window</span>
                )}
              </div>
            </div>

            <div>
              <span className="text-ink-secondary uppercase tracking-widest text-[10px]">95th Percentile Overhead:</span>
              <p className="mt-1 font-mono text-xl font-bold text-amber-300">
                {(p['governance_overhead_ms']?.p95 || 0).toFixed(2)}ms
              </p>
              <p className="font-mono text-[10px] text-ink-secondary/70">
                P99: {(p['governance_overhead_ms']?.p99 || 0).toFixed(2)}ms
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Full Live Percentile Table */}
      <LiveMetricsPanel metrics={currentMetrics} isConnected={isConnected} />
    </div>
  );
}
