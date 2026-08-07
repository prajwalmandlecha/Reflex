'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/gov/status-badge';
import { SpendBar } from '@/components/gov/spend-bar';
import { formatCurrency, pct } from '@/lib/format';
import type { AgentInstance, AgentClass, ActivityEvent } from '@/lib/types';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Activity, TrendingUp, Zap, AlertTriangle } from 'lucide-react';

/**
 * Fleet Monitor — a live operations panel replacing the Fleet Radar.
 * Shows real-time throughput, spend trajectory, and a compact agent grid
 * with inline status and spend bars. Actually useful for an operator.
 */
export function FleetMonitor({
  instances,
  classes,
  activityFeed,
  onAgentClick,
}: {
  instances: AgentInstance[];
  classes: AgentClass[];
  activityFeed: ActivityEvent[];
  onAgentClick?: (agentId: string) => void;
}) {
  // Build throughput sparkline data from the activity feed (last 30 buckets)
  const throughputData = useMemo(() => {
    const buckets: { time: string; allow: number; deny: number }[] = [];
    const now = Date.now();
    const bucketSize = 10000; // 10s buckets
    for (let i = 29; i >= 0; i--) {
      const bucketStart = now - i * bucketSize;
      const bucketEnd = bucketStart + bucketSize;
      const events = activityFeed.filter((e) => {
        const t = new Date(e.timestamp).getTime();
        return t >= bucketStart && t < bucketEnd;
      });
      buckets.push({
        time: new Date(bucketStart).toLocaleTimeString('en-US', { hour12: false, minute: '2-digit', second: '2-digit' }),
        allow: events.filter((e) => e.decision === 'allow').length,
        deny: events.filter((e) => e.decision === 'deny').length,
      });
    }
    return buckets;
  }, [activityFeed]);

  // Spend trajectory — REAL cumulative spend built from the activity feed's
  // allow events (spend_delta_cents) within the LAST 24h only, bucketed per 2h.
  // Events older than the window are excluded so stale spend isn't mis-bucketed
  // onto the axis. X labels are real clock times, not "0h/8h/…" offsets.
  const spendTrajectory = useMemo(() => {
    const totalCap = instances.reduce((s, i) => s + i.capToday, 0);
    const now = Date.now();
    const bucketMs = 2 * 60 * 60 * 1000; // 2h buckets over 24h
    const buckets = 12;
    const windowStart = now - buckets * bucketMs; // 24h ago

    // Collect real spend events INSIDE the 24h window, with timestamps.
    const spendEvents = activityFeed
      .filter((e) => e.decision === 'allow')
      .map((e) => ({
        t: new Date(e.timestamp).getTime(),
        cents: (e as any).spend_delta_cents ?? (e as any).spendDeltaCents ?? 0,
      }))
      .filter((e) => !isNaN(e.t) && e.cents > 0 && e.t >= windowStart)
      .sort((a, b) => a.t - b.t);

    const points: { label: string; spend: number; cap: number }[] = [];
    let cumulative = 0;
    for (let b = buckets; b >= 0; b--) {
      const bucketEnd = now - b * bucketMs;
      // Add spend events that occurred up to this bucket boundary (within window).
      while (spendEvents.length && spendEvents[0].t <= bucketEnd) {
        cumulative += spendEvents.shift()!.cents;
      }
      const d = new Date(bucketEnd);
      points.push({
        label: d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
        spend: Math.round(cumulative / 100), // cents → dollars
        cap: totalCap,
      });
    }
    return points;
  }, [instances, activityFeed]);

  const totalSpend = instances.reduce((s, i) => s + i.spendToday, 0);
  const totalCap = instances.reduce((s, i) => s + i.capToday, 0);
  const activeCount = instances.filter((i) => i.status === 'active').length;
  const revokedCount = instances.filter((i) => i.status === 'revoked').length;
  const killedCount = instances.filter((i) => i.status === 'killed').length;
  const degradedCount = instances.filter((i) => i.degraded).length;
  const recentDenies = activityFeed.filter((e) => e.decision === 'deny').length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Throughput chart */}
      <div className="glass glass-edge relative overflow-hidden rounded-2xl p-5 lg:col-span-2">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
              <Activity className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink-secondary">
                Fleet Throughput
              </h3>
              <p className="font-mono text-[10px] text-ink-secondary/60">
                Actions per 10s — last 5 minutes
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-signal-healthy" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-secondary">Allow</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-signal-stopped" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-secondary">Deny</span>
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={throughputData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="grad-allow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3DDC84" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#3DDC84" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="grad-deny" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#E5484D" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#E5484D" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#8B96A3', fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} interval={6} />
            <YAxis tick={{ fontSize: 9, fill: '#8B96A3', fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} width={28} />
            <Tooltip
              contentStyle={{
                background: 'rgba(18, 26, 36, 0.9)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                fontFamily: 'IBM Plex Mono',
                fontSize: '11px',
                backdropFilter: 'blur(12px)',
              }}
              labelStyle={{ color: '#8B96A3' }}
            />
            <Area type="monotone" dataKey="allow" stroke="#3DDC84" strokeWidth={1.5} fill="url(#grad-allow)" />
            <Area type="monotone" dataKey="deny" stroke="#E5484D" strokeWidth={1.5} fill="url(#grad-deny)" />
          </AreaChart>
        </ResponsiveContainer>

        {/* Spend trajectory */}
        <div className="mt-4 border-t border-white/5 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-ink-secondary" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                Spend Trajectory (24h)
              </span>
            </div>
            <span className="font-mono text-xs text-ink-primary tabular">
              {formatCurrency(totalSpend)} <span className="text-ink-secondary">/ {formatCurrency(totalCap)}</span>
            </span>
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <AreaChart data={spendTrajectory} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="grad-spend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4C8DFF" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#4C8DFF" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#8B96A3', fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} interval={3} />
              <YAxis tick={{ fontSize: 9, fill: '#8B96A3', fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} />
              <Tooltip
                contentStyle={{
                  background: 'rgba(18, 26, 36, 0.9)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                  fontFamily: 'IBM Plex Mono',
                  fontSize: '11px',
                  backdropFilter: 'blur(12px)',
                }}
                formatter={(v: number) => formatCurrency(v)}
              />
              <Area type="monotone" dataKey="spend" stroke="#4C8DFF" strokeWidth={1.5} fill="url(#grad-spend)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Live metrics + agent grid */}
      <div className="flex flex-col gap-4">
        {/* Quick metrics */}
        <div className="grid grid-cols-2 gap-3">
          <div className="glass glass-edge relative flex flex-col gap-1 rounded-2xl p-4">
            <div className="flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-signal-healthy" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Active</span>
            </div>
            <span className="font-mono text-xl text-signal-healthy tabular">{activeCount}</span>
          </div>
          <div className="glass glass-edge relative flex flex-col gap-1 rounded-2xl p-4">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-signal-caution" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Revoked</span>
            </div>
            <span className="font-mono text-xl text-signal-caution tabular">{revokedCount}</span>
          </div>
          <div className="glass glass-edge relative flex flex-col gap-1 rounded-2xl p-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Killed</span>
            <span className="font-mono text-xl text-signal-stopped tabular">{killedCount}</span>
          </div>
          <div className="glass glass-edge relative flex flex-col gap-1 rounded-2xl p-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Degraded</span>
            <span className={cn('font-mono text-xl tabular', degradedCount > 0 ? 'text-signal-caution' : 'text-ink-secondary')}>
              {degradedCount}
            </span>
          </div>
          <div className="glass glass-edge relative flex flex-col gap-1 rounded-2xl p-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Denies</span>
            <span className="font-mono text-xl text-ink-primary tabular">{recentDenies}</span>
          </div>
        </div>

        {/* Agent grid */}
        <div className="glass glass-edge relative flex flex-col rounded-2xl">
          <div className="px-4 py-2.5">
            <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink-secondary">
              Agent Grid
            </h3>
          </div>
          <div className="max-h-[280px] overflow-auto px-3 pb-3">
            <div className="space-y-1">
              {instances.map((inst) => {
                const cls = classes.find((c) => c.id === inst.classId);
                const p = pct(inst.spendToday, inst.capToday);
                const isHot = p >= 80;
                return (
                  <button
                    key={inst.id}
                    onClick={() => onAgentClick?.(inst.id)}
                    className={cn(
                      'group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-all',
                      'hover:bg-white/5'
                    )}
                  >
                    <StatusBadge status={inst.status} size="sm" />
                    {inst.degraded && (
                      <span
                        title={`Unreachable tools: ${(inst.unreachableTools || []).join(', ') || 'unknown'}`}
                        className="inline-flex items-center rounded-full border border-signal-caution/20 bg-signal-caution/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-signal-caution"
                      >
                        degraded
                      </span>
                    )}
                    <span className="flex-1 truncate font-mono text-[11px] text-ink-primary group-hover:text-accent">
                      {inst.id}
                    </span>
                    {inst.capToday > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-16 overflow-hidden rounded-full bg-white/5">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              isHot ? 'bg-signal-caution' : 'bg-signal-healthy'
                            )}
                            style={{ width: `${Math.min(100, p)}%` }}
                          />
                        </div>
                        <span className="w-10 text-right font-mono text-[10px] text-ink-secondary tabular">
                          {Math.round(p)}%
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
