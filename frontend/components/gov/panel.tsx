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
  const accentStyles = {
    healthy: { dot: 'bg-emerald-500' },
    caution: { dot: 'bg-amber-500' },
    stopped: { dot: 'bg-rose-500' },
    accent: { dot: 'bg-cyan-500' },
  };

  const currentAccent = accent ? accentStyles[accent] : null;

  return (
    <div
      className={cn(
        'glass glass-edge relative flex flex-col gap-1.5 rounded-2xl p-5 transition-[background-color,border-color,box-shadow] duration-200',
        className
      )}
    >
      <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-ink-secondary relative z-10">
        {currentAccent && (
          <span className={cn('h-1.5 w-1.5 rounded-sm', currentAccent.dot)} />
        )}
        {label}
      </span>
      <span className="font-mono text-2xl text-ink-primary tabular relative z-10">{value}</span>
      {sub && <span className="font-mono text-[11px] text-ink-secondary relative z-10">{sub}</span>}
    </div>
  );
}
