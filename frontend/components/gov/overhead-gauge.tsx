'use client';

import React from 'react';

interface OverheadGaugeProps {
  overheadMs: number;
  totalMs: number;
}

export function OverheadGauge({ overheadMs, totalMs }: OverheadGaugeProps) {
  const pct = totalMs > 0 ? (overheadMs / totalMs) * 100 : 0;
  const clampedPct = Math.min(Math.max(pct, 0), 100);

  // Color coding
  let strokeColor = '#3DDC84'; // Green (< 25%)
  if (clampedPct >= 50) strokeColor = '#E5484D'; // Red
  else if (clampedPct >= 25) strokeColor = '#F5A623'; // Amber

  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clampedPct / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center p-4 bg-slate-900/60 rounded-xl border border-slate-800">
      <div className="relative w-28 h-28 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="56"
            cy="56"
            r={radius}
            stroke="#1e293b"
            strokeWidth="8"
            fill="transparent"
          />
          <circle
            cx="56"
            cy="56"
            r={radius}
            stroke={strokeColor}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
            className="transition-[stroke-dashoffset] duration-500 ease-out"
          />
        </svg>
        <div className="absolute flex flex-col items-center justify-center text-center">
          <span className="text-xl font-bold font-mono text-white">{clampedPct.toFixed(1)}%</span>
          <span className="text-[10px] text-gray-400 font-mono">Overhead</span>
        </div>
      </div>

      <div className="mt-3 text-center">
        <p className="text-xs font-mono text-gray-300">
          Governance: <span className="font-bold text-white">{overheadMs.toFixed(2)}ms</span>
        </p>
        <p className="text-[11px] text-gray-500 font-mono">
          Out of <span className="text-gray-300">{totalMs.toFixed(2)}ms</span> total
        </p>
      </div>
    </div>
  );
}
