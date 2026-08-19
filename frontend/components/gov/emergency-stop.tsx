'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ShieldAlert, Octagon, Play } from 'lucide-react';

/**
 * Emergency Stop control — a deliberately weighty, two-stage control.
 * Stage 1: Press and hold the button (1.5s) to "arm".
 * Stage 2: Confirm in the overlay that appears.
 * Never a single accidental click.
 */
export function EmergencyStopControl({
  onConfirm,
  compact = false,
  isStopped = false,
}: {
  onConfirm: () => void;
  compact?: boolean;
  isStopped?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStart = useRef<number>(0);
  const HOLD_DURATION = 1500;

  const startHold = useCallback(() => {
    setHolding(true);
    holdStart.current = Date.now();
    holdTimer.current = setInterval(() => {
      const elapsed = Date.now() - holdStart.current;
      const p = Math.min(100, (elapsed / HOLD_DURATION) * 100);
      setProgress(p);
      if (p >= 100) {
        if (holdTimer.current) clearInterval(holdTimer.current);
        setArmed(true);
        setHolding(false);
        setProgress(0);
      }
    }, 16);
  }, []);

  const cancelHold = useCallback(() => {
    if (holdTimer.current) clearInterval(holdTimer.current);
    setHolding(false);
    setProgress(0);
  }, []);

  useEffect(() => {
    return () => {
      if (holdTimer.current) clearInterval(holdTimer.current);
    };
  }, []);

  if (isStopped) {
    return (
      <button
        onClick={onConfirm}
        className={cn(
          'flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/20 px-4 py-2',
          'font-mono text-xs font-bold uppercase tracking-widest text-emerald-400',
          'backdrop-blur-md transition-[background-color,color,border-color] hover:bg-emerald-500 hover:text-black shadow-[0_0_20px_-4px_rgba(52,211,153,0.4)] cursor-pointer',
          compact && 'px-3 py-1.5 text-[10px]'
        )}
      >
        <Play className={cn(compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
        Start / Resume Fleet
      </button>
    );
  }

  if (armed) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
          className={cn(
            'group flex items-center gap-2 rounded-xl border border-signal-stopped/30 bg-signal-stopped/15 px-4 py-2',
            'font-mono text-xs font-semibold uppercase tracking-widest text-signal-stopped',
            'backdrop-blur-md transition-[background-color,color,border-color] hover:bg-signal-stopped hover:text-white',
            'shadow-[0_0_20px_-4px_rgba(229,72,77,0.4)]',
            compact && 'px-3 py-1.5 text-[10px]'
          )}
        >
          <Octagon className={cn(compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
          Confirm Stop
        </button>
        <button
          onClick={() => setArmed(false)}
          className={cn(
            'rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs uppercase tracking-widest text-ink-secondary backdrop-blur-md',
            'transition-colors hover:text-ink-primary',
            compact && 'px-2 py-1.5 text-[10px]'
          )}
        >
          Disarm
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onMouseDown={startHold}
        onMouseUp={cancelHold}
        onMouseLeave={cancelHold}
        onTouchStart={startHold}
        onTouchEnd={cancelHold}
        className={cn(
          'group relative flex items-center gap-2 overflow-hidden rounded-xl border px-4 py-2',
          'font-mono text-xs font-semibold uppercase tracking-widest backdrop-blur-md transition-[background-color,color,border-color]',
          compact && 'px-3 py-1.5 text-[10px]',
          holding
            ? 'border-signal-stopped/40 bg-signal-stopped/10 text-signal-stopped shadow-[0_0_24px_-4px_rgba(229,72,77,0.4)]'
            : 'border-signal-stopped/20 bg-signal-stopped/5 text-signal-stopped/80 hover:border-signal-stopped/40 hover:bg-signal-stopped/10 hover:text-signal-stopped'
        )}
        aria-label="Emergency stop — press and hold to arm"
      >
        <ShieldAlert className={cn(compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
        <span>Emergency Stop</span>
        {holding && (
          <span
            className="absolute bottom-0 left-0 h-0.5 bg-signal-stopped transition-[width] duration-150 ease-out"
            style={{ width: `${progress}%` }}
          />
        )}
      </button>
      {holding && (
        <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-widest text-signal-stopped">
          Hold to arm…
        </span>
      )}
    </div>
  );
}
