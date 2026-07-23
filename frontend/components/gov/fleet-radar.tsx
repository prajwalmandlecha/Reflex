'use client';

import { useMemo, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { AgentInstance, AgentClass } from '@/lib/types';

type RadarNode = {
  id: string;
  classId: string;
  className: string;
  status: 'active' | 'revoked' | 'killed';
  angle: number;
  radius: number;
  pulsePhase: number;
};

const statusColor: Record<string, string> = {
  active: '#3DDC84',
  revoked: '#F5A623',
  killed: '#E5484D',
};

export function FleetRadar({
  instances,
  classes,
  size = 440,
  onNodeClick,
}: {
  instances: AgentInstance[];
  classes: AgentClass[];
  size?: number;
  onNodeClick?: (agentId: string) => void;
}) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const interval = setInterval(() => setTick((t) => t + 1), 50);
    return () => clearInterval(interval);
  }, [reducedMotion]);

  const nodes = useMemo<RadarNode[]>(() => {
    const classMap = new Map(classes.map((c) => [c.id, c.name]));
    const byClass = new Map<string, AgentInstance[]>();
    for (const inst of instances) {
      const arr = byClass.get(inst.classId) ?? [];
      arr.push(inst);
      byClass.set(inst.classId, arr);
    }
    const classIds = Array.from(byClass.keys());
    const result: RadarNode[] = [];
    classIds.forEach((classId, classIdx) => {
      const group = byClass.get(classId)!;
      const orbitRadius = 70 + classIdx * 42;
      group.forEach((inst, i) => {
        const baseAngle = (i / group.length) * Math.PI * 2;
        const jitter = Math.sin(i * 7.3 + classIdx * 3.1) * 0.15;
        result.push({
          id: inst.id,
          classId,
          className: classMap.get(classId) ?? classId,
          status: inst.status,
          angle: baseAngle + jitter,
          radius: orbitRadius,
          pulsePhase: (i * 0.37 + classIdx * 0.21) % (Math.PI * 2),
        });
      });
    });
    return result;
  }, [instances, classes]);

  const center = size / 2;
  const maxRadius = Math.max(...nodes.map((n) => n.radius), 100) + 30;
  const scale = (size / 2 - 20) / maxRadius;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="overflow-visible">
        {/* Concentric orbit rings */}
        {Array.from(new Set(nodes.map((n) => n.radius))).map((r, i) => (
          <circle
            key={i}
            cx={center}
            cy={center}
            r={r * scale}
            fill="none"
            stroke="#232B35"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        ))}

        {/* Cross hairs */}
        <line x1={center} y1={0} x2={center} y2={size} stroke="#232B35" strokeWidth={0.5} />
        <line x1={0} y1={center} x2={size} y2={center} stroke="#232B35" strokeWidth={0.5} />

        {/* Center hub */}
        <circle cx={center} cy={center} r={6} fill="#4C8DFF" opacity={0.15} />
        <circle cx={center} cy={center} r={3} fill="#4C8DFF" />
        <text
          x={center}
          y={center + 22}
          textAnchor="middle"
          className="font-mono"
          fill="#8B96A3"
          fontSize={9}
          letterSpacing={1}
        >
          FLEET
        </text>

        {/* Radar sweep (only if motion allowed) */}
        {!reducedMotion && (
          <g style={{ transformOrigin: 'center', animation: 'radar-sweep 4s linear infinite' }}>
            <defs>
              <linearGradient id="sweep-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#4C8DFF" stopOpacity={0} />
                <stop offset="100%" stopColor="#4C8DFF" stopOpacity={0.12} />
              </linearGradient>
            </defs>
            <path
              d={`M ${center} ${center} L ${center} ${center - maxRadius * scale} A ${maxRadius * scale} ${maxRadius * scale} 0 0 1 ${center + maxRadius * scale * Math.sin(0.6)} ${center - maxRadius * scale * Math.cos(0.6)} Z`}
              fill="url(#sweep-grad)"
            />
          </g>
        )}

        {/* Nodes */}
        {nodes.map((node) => {
          const x = center + Math.cos(node.angle - Math.PI / 2) * node.radius * scale;
          const y = center + Math.sin(node.angle - Math.PI / 2) * node.radius * scale;
          const color = statusColor[node.status];
          const pulse = reducedMotion
            ? 1
            : 0.7 + 0.3 * Math.sin(tick * 0.05 + node.pulsePhase * 6);
          const nodeRadius = node.status === 'killed' ? 2 : 3.5;

          return (
            <g
              key={node.id}
              className="cursor-pointer"
              onClick={() => onNodeClick?.(node.id)}
            >
              {/* Pulse halo for active nodes */}
              {node.status === 'active' && !reducedMotion && (
                <circle
                  cx={x}
                  cy={y}
                  r={nodeRadius + 4}
                  fill={color}
                  opacity={pulse * 0.25}
                />
              )}
              <circle cx={x} cy={y} r={nodeRadius} fill={color} opacity={node.status === 'killed' ? 0.5 : 0.9} />
              <circle cx={x} cy={y} r={nodeRadius + 1.5} fill="none" stroke={color} strokeWidth={0.5} opacity={0.4} />
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-0 left-0 flex flex-col gap-1">
        {[
          { label: 'Active', color: '#3DDC84' },
          { label: 'Revoked', color: '#F5A623' },
          { label: 'Killed', color: '#E5484D' },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
            <span className="font-mono text-[9px] uppercase tracking-widest text-ink-secondary">
              {l.label}
            </span>
          </div>
        ))}
      </div>

      {/* Orbit labels */}
      <div className="absolute right-0 top-0 flex flex-col gap-0.5 text-right">
        {classes.map((c, i) => (
          <div key={c.id} className="flex items-center justify-end gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-secondary">
              {c.name}
            </span>
            <span className="inline-block h-px w-4" style={{ background: '#4C8DFF', opacity: 0.3 + i * 0.1 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
