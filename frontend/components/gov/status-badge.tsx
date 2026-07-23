'use client';

import { cn } from '@/lib/utils';
import type { AgentStatus, FleetStatus } from '@/lib/types';

type StatusKind = AgentStatus | FleetStatus | 'connected' | 'error' | 'pending' | 'active' | 'draft';

const labelMap: Record<string, string> = {
  active: 'Active',
  revoked: 'Revoked',
  killed: 'Killed',
  healthy: 'Healthy',
  degraded: 'Degraded',
  stopped: 'Stopped',
  connected: 'Connected',
  error: 'Error',
  pending: 'Pending',
  draft: 'Draft',
};

const colorMap: Record<string, { dot: string; text: string; bg: string; border: string; glow: string }> = {
  active: { dot: 'bg-signal-healthy', text: 'text-signal-healthy', bg: 'bg-signal-healthy/10', border: 'border-signal-healthy/20', glow: 'shadow-[0_0_12px_-2px_rgba(61,220,132,0.3)]' },
  healthy: { dot: 'bg-signal-healthy', text: 'text-signal-healthy', bg: 'bg-signal-healthy/10', border: 'border-signal-healthy/20', glow: 'shadow-[0_0_12px_-2px_rgba(61,220,132,0.3)]' },
  connected: { dot: 'bg-signal-healthy', text: 'text-signal-healthy', bg: 'bg-signal-healthy/10', border: 'border-signal-healthy/20', glow: 'shadow-[0_0_12px_-2px_rgba(61,220,132,0.3)]' },
  revoked: { dot: 'bg-signal-caution', text: 'text-signal-caution', bg: 'bg-signal-caution/10', border: 'border-signal-caution/20', glow: 'shadow-[0_0_12px_-2px_rgba(245,166,35,0.3)]' },
  degraded: { dot: 'bg-signal-caution', text: 'text-signal-caution', bg: 'bg-signal-caution/10', border: 'border-signal-caution/20', glow: 'shadow-[0_0_12px_-2px_rgba(245,166,35,0.3)]' },
  pending: { dot: 'bg-signal-caution', text: 'text-signal-caution', bg: 'bg-signal-caution/10', border: 'border-signal-caution/20', glow: 'shadow-[0_0_12px_-2px_rgba(245,166,35,0.3)]' },
  draft: { dot: 'bg-signal-caution', text: 'text-signal-caution', bg: 'bg-signal-caution/10', border: 'border-signal-caution/20', glow: 'shadow-[0_0_12px_-2px_rgba(245,166,35,0.3)]' },
  killed: { dot: 'bg-signal-stopped', text: 'text-signal-stopped', bg: 'bg-signal-stopped/10', border: 'border-signal-stopped/20', glow: 'shadow-[0_0_12px_-2px_rgba(229,72,77,0.3)]' },
  stopped: { dot: 'bg-signal-stopped', text: 'text-signal-stopped', bg: 'bg-signal-stopped/10', border: 'border-signal-stopped/20', glow: 'shadow-[0_0_12px_-2px_rgba(229,72,77,0.3)]' },
  error: { dot: 'bg-signal-stopped', text: 'text-signal-stopped', bg: 'bg-signal-stopped/10', border: 'border-signal-stopped/20', glow: 'shadow-[0_0_12px_-2px_rgba(229,72,77,0.3)]' },
};

export function StatusBadge({
  status,
  size = 'sm',
  className,
}: {
  status: StatusKind;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const c = colorMap[status] ?? colorMap.active;
  const label = labelMap[status] ?? status;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-mono uppercase tracking-wide backdrop-blur-md',
        c.bg,
        c.border,
        c.text,
        c.glow,
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        className
      )}
    >
      <span className={cn('inline-block rounded-full', c.dot, size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2')} />
      {label}
    </span>
  );
}

export function StatusDot({ status, className }: { status: StatusKind; className?: string }) {
  const c = colorMap[status] ?? colorMap.active;
  return <span className={cn('inline-block rounded-full', c.dot, className ?? 'h-2 w-2')} />;
}
