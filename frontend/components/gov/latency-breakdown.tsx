'use client';

import React from 'react';

interface LatencyBreakdownProps {
  killswitchMs: number;
  constraintMs: number;
  policyMs: number;
  spendMs: number;
  downstreamMs: number;
  totalMs: number;
}

export function LatencyBreakdownBar({
  killswitchMs,
  constraintMs,
  policyMs,
  spendMs,
  downstreamMs,
  totalMs,
}: LatencyBreakdownProps) {
  const safeTotal = max(totalMs, 0.001);
  const ksPct = (killswitchMs / safeTotal) * 100;
  const constPct = (constraintMs / safeTotal) * 100;
  const policyPct = (policyMs / safeTotal) * 100;
  const spendPct = (spendMs / safeTotal) * 100;
  const downPct = (downstreamMs / safeTotal) * 100;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-xs font-mono text-gray-400">
        <span>Total Request Time: <strong className="text-white">{totalMs.toFixed(2)}ms</strong></span>
        <span>Downstream: <strong className="text-white">{downstreamMs.toFixed(2)}ms</strong></span>
      </div>

      <div className="h-4 w-full bg-slate-900 rounded flex overflow-hidden border border-slate-800">
        <div
          style={{ width: `${ksPct}%` }}
          className="bg-amber-500 h-full transition-all duration-300"
          title={`Killswitch: ${killswitchMs.toFixed(2)}ms (${ksPct.toFixed(1)}%)`}
        />
        <div
          style={{ width: `${constPct}%` }}
          className="bg-cyan-500 h-full transition-all duration-300"
          title={`Constraints: ${constraintMs.toFixed(2)}ms (${constPct.toFixed(1)}%)`}
        />
        <div
          style={{ width: `${policyPct}%` }}
          className="bg-blue-500 h-full transition-all duration-300"
          title={`OPA Policy: ${policyMs.toFixed(2)}ms (${policyPct.toFixed(1)}%)`}
        />
        <div
          style={{ width: `${spendPct}%` }}
          className="bg-purple-500 h-full transition-all duration-300"
          title={`Spend Check: ${spendMs.toFixed(2)}ms (${spendPct.toFixed(1)}%)`}
        />
        <div
          style={{ width: `${downPct}%` }}
          className="bg-emerald-500 h-full transition-all duration-300"
          title={`Downstream Hop: ${downstreamMs.toFixed(2)}ms (${downPct.toFixed(1)}%)`}
        />
      </div>

      <div className="grid grid-cols-5 gap-2 text-[10px] font-mono">
        <div className="flex items-center gap-1 text-amber-400">
          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
          <span>Kill: {killswitchMs.toFixed(2)}ms</span>
        </div>
        <div className="flex items-center gap-1 text-cyan-400">
          <span className="w-2 h-2 rounded-full bg-cyan-500 inline-block" />
          <span>Const: {constraintMs.toFixed(2)}ms</span>
        </div>
        <div className="flex items-center gap-1 text-blue-400">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
          <span>OPA: {policyMs.toFixed(2)}ms</span>
        </div>
        <div className="flex items-center gap-1 text-purple-400">
          <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
          <span>Spend: {spendMs.toFixed(2)}ms</span>
        </div>
        <div className="flex items-center gap-1 text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
          <span>Downstream: {downstreamMs.toFixed(2)}ms</span>
        </div>
      </div>
    </div>
  );
}

function max(a: number, b: number) {
  return a > b ? a : b;
}
