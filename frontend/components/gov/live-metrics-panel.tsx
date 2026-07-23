'use client';

import React from 'react';
import type { MetricsSnapshot } from '@/lib/types';

interface LiveMetricsPanelProps {
  metrics: MetricsSnapshot | null;
  isConnected: boolean;
}

export function LiveMetricsPanel({ metrics, isConnected }: LiveMetricsPanelProps) {
  const percentiles = metrics?.latency_percentiles || {};

  const stages = [
    { key: 'total_ms', name: 'Total End-to-End', color: 'text-white' },
    { key: 'governance_overhead_ms', name: 'Governance Overhead', color: 'text-amber-400' },
    { key: 'policy_ms', name: 'OPA Policy Eval', color: 'text-blue-400' },
    { key: 'spend_ms', name: 'Redis Spend Check', color: 'text-purple-400' },
    { key: 'constraint_ms', name: 'Constraint Checker', color: 'text-cyan-400' },
    { key: 'killswitch_ms', name: 'Killswitch Check', color: 'text-rose-400' },
    { key: 'downstream_ms', name: 'Downstream Hop', color: 'text-emerald-400' },
  ];

  return (
    <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold font-mono text-gray-200 flex items-center gap-2">
          <span>Live Latency Breakdown (Percentiles)</span>
        </h3>
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-gray-400">{isConnected ? 'WS Stream Active' : 'Disconnected'}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs font-mono">
          <thead>
            <tr className="border-b border-slate-800 text-gray-400">
              <th className="py-2 px-3 font-semibold">Governance Stage</th>
              <th className="py-2 px-3 font-semibold text-right">p50 (Median)</th>
              <th className="py-2 px-3 font-semibold text-right">p95 (95th)</th>
              <th className="py-2 px-3 font-semibold text-right">p99 (99th)</th>
              <th className="py-2 px-3 font-semibold text-right">Average</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {stages.map((st) => {
              const stat = percentiles[st.key] || { p50: 0, p95: 0, p99: 0, avg: 0 };
              return (
                <tr key={st.key} className="hover:bg-slate-800/40 transition-colors">
                  <td className={`py-2 px-3 font-medium ${st.color}`}>{st.name}</td>
                  <td className="py-2 px-3 text-right text-gray-200">{stat.p50.toFixed(2)}ms</td>
                  <td className="py-2 px-3 text-right text-amber-300 font-semibold">{stat.p95.toFixed(2)}ms</td>
                  <td className="py-2 px-3 text-right text-rose-400 font-bold">{stat.p99.toFixed(2)}ms</td>
                  <td className="py-2 px-3 text-right text-gray-400">{stat.avg.toFixed(2)}ms</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
