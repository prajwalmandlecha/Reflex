'use client';

import { cn } from '@/lib/utils';
import { pct, capStatus, formatCurrency } from '@/lib/format';

export function SpendBar({
  used,
  cap,
  showLabel = false,
  className,
}: {
  used: number;
  cap: number;
  showLabel?: boolean;
  className?: string;
}) {
  if (cap <= 0) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <div className="h-1.5 flex-1 rounded-full bg-white/5" />
        {showLabel && (
          <span className="font-mono text-[10px] text-ink-secondary">N/A</span>
        )}
      </div>
    );
  }

  const p = pct(used, cap);
  const status = capStatus(used, cap);
  const barColor =
    status === 'stopped'
      ? 'bg-signal-stopped'
      : status === 'caution'
      ? 'bg-signal-caution'
      : 'bg-signal-healthy';
  const barGlow =
    status === 'stopped'
      ? 'shadow-[0_0_8px_rgba(229,72,77,0.4)]'
      : status === 'caution'
      ? 'shadow-[0_0_8px_rgba(245,166,35,0.4)]'
      : 'shadow-[0_0_8px_rgba(61,220,132,0.3)]';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', barColor, barGlow)}
          style={{ width: `${p}%` }}
        />
      </div>
      {showLabel && (
        <span className="whitespace-nowrap font-mono text-[10px] text-ink-secondary tabular">
          {formatCurrency(used)} / {formatCurrency(cap)}
        </span>
      )}
    </div>
  );
}
