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
    healthy: {
      border: 'border-l-2 border-l-emerald-500',
      glow: 'shadow-[0_0_20px_-3px_rgba(16,185,129,0.15)]',
      bgGrad: 'bg-gradient-to-r from-emerald-500/[0.08] via-emerald-500/[0.02] to-transparent',
    },
    caution: {
      border: 'border-l-2 border-l-amber-500',
      glow: 'shadow-[0_0_20px_-3px_rgba(245,158,11,0.15)]',
      bgGrad: 'bg-gradient-to-r from-amber-500/[0.08] via-amber-500/[0.02] to-transparent',
    },
    stopped: {
      border: 'border-l-2 border-l-rose-500',
      glow: 'shadow-[0_0_20px_-3px_rgba(244,63,94,0.15)]',
      bgGrad: 'bg-gradient-to-r from-rose-500/[0.08] via-rose-500/[0.02] to-transparent',
    },
    accent: {
      border: 'border-l-2 border-l-cyan-500',
      glow: 'shadow-[0_0_20px_-3px_rgba(6,182,212,0.15)]',
      bgGrad: 'bg-gradient-to-r from-cyan-500/[0.08] via-cyan-500/[0.02] to-transparent',
    },
  };

  const currentAccent = accent ? accentStyles[accent] : null;

  return (
    <div
      className={cn(
        'glass glass-edge relative flex flex-col gap-1.5 rounded-2xl p-5 transition-all duration-200',
        currentAccent?.border,
        currentAccent?.glow,
        className
      )}
    >
      {currentAccent && (
        <div className={cn('absolute inset-0 rounded-2xl pointer-events-none', currentAccent.bgGrad)} />
      )}
      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary relative z-10">
        {label}
      </span>
      <span className="font-mono text-2xl text-ink-primary tabular relative z-10">{value}</span>
      {sub && <span className="font-mono text-[11px] text-ink-secondary relative z-10">{sub}</span>}
    </div>
  );
}
