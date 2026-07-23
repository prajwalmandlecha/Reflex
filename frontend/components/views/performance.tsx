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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold font-mono text-white">Performance & Latency Instrumentation</h1>
          <p className="text-xs text-gray-400 font-mono mt-1">
            Real-time per-stage governance overhead tracking & latency breakdown.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono text-gray-300">
            Requests/sec: <strong className="text-emerald-400">{(currentMetrics?.requests_per_second || 0).toFixed(1)}</strong>
          </div>
          <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono text-gray-300">
            Window: <strong className="text-blue-400">{currentMetrics?.window_seconds || 300}s</strong>
          </div>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <p className="text-xs font-mono text-gray-400">Total Requests</p>
          <p className="text-2xl font-bold font-mono text-white mt-1">
            {currentMetrics?.total_requests || 0}
          </p>
          <div className="flex gap-3 text-[10px] font-mono mt-2 text-gray-400">
            <span className="text-emerald-400">Allow: {currentMetrics?.allow_count || 0}</span>
            <span className="text-rose-400">Deny: {currentMetrics?.deny_count || 0}</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <p className="text-xs font-mono text-gray-400">Governance Overhead (p50)</p>
          <p className="text-2xl font-bold font-mono text-amber-400 mt-1">
            {overheadP50.toFixed(2)}ms
          </p>
          <p className="text-[10px] font-mono text-gray-500 mt-2">
            Kill + Const + OPA + Spend
          </p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <p className="text-xs font-mono text-gray-400">Downstream Bank Hop (p50)</p>
          <p className="text-2xl font-bold font-mono text-emerald-400 mt-1">
            {downstreamP50.toFixed(2)}ms
          </p>
          <p className="text-[10px] font-mono text-gray-500 mt-2">
            Bank MCP / REST Target
          </p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <p className="text-xs font-mono text-gray-400">Total Request Time (p50)</p>
          <p className="text-2xl font-bold font-mono text-blue-400 mt-1">
            {totalP50.toFixed(2)}ms
          </p>
          <p className="text-[10px] font-mono text-gray-500 mt-2">
            End-to-End Agent Latency
          </p>
        </div>
      </div>

      {/* Main Grid: Gauge + Stacked Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <OverheadGauge overheadMs={overheadP50} totalMs={totalP50} />
        </div>

        <div className="md:col-span-2 bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold font-mono text-gray-200 mb-1">Median Latency Stacked Breakdown</h3>
            <p className="text-xs text-gray-400 font-mono mb-4">
              Relative time spent in each governance layer versus the downstream bank target.
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

          <div className="mt-6 pt-4 border-t border-slate-800/80 grid grid-cols-2 gap-4 text-xs font-mono">
            <div>
              <span className="text-gray-400">Denials by Stage:</span>
              <div className="mt-1 space-y-1">
                {Object.entries(currentMetrics?.deny_by_stage || {}).map(([st, cnt]) => (
                  <div key={st} className="flex justify-between text-gray-300">
                    <span>{st || 'other'}:</span>
                    <strong className="text-rose-400">{cnt}</strong>
                  </div>
                ))}
                {Object.keys(currentMetrics?.deny_by_stage || {}).length === 0 && (
                  <span className="text-gray-500 text-[11px]">No denials in window</span>
                )}
              </div>
            </div>

            <div>
              <span className="text-gray-400">95th Percentile Overhead:</span>
              <p className="text-lg font-bold text-amber-300 mt-1 font-mono">
                {(p['governance_overhead_ms']?.p95 || 0).toFixed(2)}ms
              </p>
              <p className="text-[10px] text-gray-500 font-mono">
                p99: {(p['governance_overhead_ms']?.p99 || 0).toFixed(2)}ms
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
