'use client';

import { cn } from '@/lib/utils';

export function Panel({
  children,
  className,
  title,
  action,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'glass glass-edge relative flex flex-col rounded-2xl',
        className
      )}
    >
      {title && (
        <div className="flex items-center justify-between px-5 py-3">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink-secondary">
            {title}
          </h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  accent,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: 'healthy' | 'caution' | 'stopped' | 'accent';
  className?: string;
}) {
  const glow =
    accent === 'healthy'
      ? 'shadow-[0_0_24px_-4px_rgba(61,220,132,0.15)]'
      : accent === 'caution'
      ? 'shadow-[0_0_24px_-4px_rgba(245,166,35,0.15)]'
      : accent === 'stopped'
      ? 'shadow-[0_0_24px_-4px_rgba(229,72,77,0.15)]'
      : accent === 'accent'
      ? 'shadow-[0_0_24px_-4px_rgba(76,141,255,0.15)]'
      : '';

  const accentLine =
    accent === 'healthy'
      ? 'bg-signal-healthy'
      : accent === 'caution'
      ? 'bg-signal-caution'
      : accent === 'stopped'
      ? 'bg-signal-stopped'
      : accent === 'accent'
      ? 'bg-accent'
      : 'bg-transparent';

  return (
    <div
      className={cn(
        'glass glass-edge relative flex flex-col gap-1.5 overflow-hidden rounded-2xl p-5',
        glow,
        className
      )}
    >
      <div className={cn('absolute left-0 top-0 h-full w-[3px] rounded-l-2xl', accentLine)} />
      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
        {label}
      </span>
      <span className="font-mono text-2xl text-ink-primary tabular">{value}</span>
      {sub && <span className="font-mono text-[11px] text-ink-secondary">{sub}</span>}
    </div>
  );
}
