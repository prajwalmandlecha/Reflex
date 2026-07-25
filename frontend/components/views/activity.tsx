'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Panel } from '@/components/gov/panel';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatTimestamp } from '@/lib/format';
import type { ActivityEvent, AgentClass } from '@/lib/types';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';

export function ActivityView({
  activityFeed,
  classes,
}: {
  activityFeed: ActivityEvent[];
  classes: AgentClass[];
}) {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [decisionFilter, setDecisionFilter] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return activityFeed.filter((evt) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !evt.agentId.toLowerCase().includes(q) &&
          !evt.action.toLowerCase().includes(q) &&
          !(evt.reason ?? '').toLowerCase().includes(q)
        )
          return false;
      }
      if (classFilter !== 'all' && evt.agentClass !== classes.find((c) => c.id === classFilter)?.name)
        return false;
      if (decisionFilter !== 'all' && evt.decision !== decisionFilter) return false;
      return true;
    });
  }, [activityFeed, search, classFilter, decisionFilter, classes]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-ink-primary">
            Activity Feed
          </h2>
          <p className="font-sans text-xs text-ink-secondary">
            Live stream of every action attempt across the fleet. Updates every few seconds.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded border border-signal-healthy/20 bg-signal-healthy/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-signal-healthy">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-signal-healthy" />
            Live Pulse · Stream Active
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
          <Input
            placeholder="Search agent, action, or reason…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-white/10 bg-white/[0.02] pl-9 font-mono text-sm placeholder:text-ink-secondary/50"
          />
        </div>
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-[180px] border-white/10 bg-white/[0.02] font-mono text-xs">
            <SelectValue placeholder="Class" />
          </SelectTrigger>
          <SelectContent className="border-border bg-white/5">
            <SelectItem value="all">All classes</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={decisionFilter} onValueChange={setDecisionFilter}>
          <SelectTrigger className="w-[120px] border-white/10 bg-white/[0.02] font-mono text-xs">
            <SelectValue placeholder="Decision" />
          </SelectTrigger>
          <SelectContent className="border-border bg-white/5">
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="allow">Allow</SelectItem>
            <SelectItem value="deny">Deny</SelectItem>
          </SelectContent>
        </Select>
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
          {filtered.length} events
        </span>
      </div>

      {/* Feed */}
      <Panel>
        <div className="max-h-[calc(100vh-260px)] overflow-auto">
          {filtered.map((evt) => {
            const isExpanded = expanded.has(evt.id);
            const agentId = evt.agentId || (evt as any).agent_id || '—';
            const agentClass = evt.agentClass || (evt as any).agent_class_id || '—';
            const bankConn = evt.bankConnectionId || (evt as any).bank_connection_id || (evt as any).service || '—';
            const latency = evt.latencyMs ?? (evt as any).total_latency_ms ?? 0;
            const action = evt.action || (evt as any).tool || '—';
            const isDeny = evt.decision === 'deny';

            return (
              <div
                key={evt.id}
                className="border-b border-white/5 last:border-0"
              >
                <div
                  className="flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-white/5"
                  onClick={() => toggle(evt.id)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-secondary" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-secondary" />
                  )}
                  <span className="shrink-0 font-mono text-[10px] text-ink-secondary tabular">
                    {formatTimestamp(evt.timestamp)}
                  </span>
                  <span
                    className={cn(
                      'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                      evt.decision === 'allow' ? 'bg-signal-healthy' : 'bg-signal-stopped'
                    )}
                  />
                  <span className="shrink-0 font-mono text-[10px] text-accent">{agentId}</span>
                  <span className="flex-1 truncate font-mono text-xs text-ink-primary">
                    {action}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 font-mono text-[10px] uppercase tracking-wider',
                      evt.decision === 'allow' ? 'text-signal-healthy' : 'text-signal-stopped'
                    )}
                  >
                    {evt.decision}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-secondary tabular">
                    {latency}ms
                  </span>
                </div>

                {isExpanded && (
                  <div className="animate-feed-slide bg-bg-deep px-4 py-3 pl-10">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px]">
                      <div>
                        <span className="text-ink-secondary">Agent: </span>
                        <span className="text-ink-primary">{agentId}</span>
                      </div>
                      <div>
                        <span className="text-ink-secondary">Class: </span>
                        <span className="text-ink-primary">{agentClass}</span>
                      </div>
                      <div>
                        <span className="text-ink-secondary">Bank Connection: </span>
                        <span className="text-ink-primary">{bankConn}</span>
                      </div>
                      <div>
                        <span className="text-ink-secondary">Latency: </span>
                        <span className="text-ink-primary">{latency}ms</span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                        Parameters
                      </span>
                      <pre className="mt-1 overflow-auto border border-white/10 bg-white/[0.02] p-2 font-mono text-[11px] text-ink-primary">
                        {JSON.stringify(evt.params, null, 2)}
                      </pre>
                    </div>
                    {evt.reason && (
                      <div
                        className={cn(
                          'mt-2 border p-2',
                          isDeny
                            ? 'border-signal-stopped/30 bg-signal-stopped/5'
                            : 'border-signal-healthy/30 bg-signal-healthy/5'
                        )}
                      >
                        <span
                          className={cn(
                            'font-mono text-[10px] uppercase tracking-widest',
                            isDeny ? 'text-signal-stopped' : 'text-signal-healthy'
                          )}
                        >
                          {isDeny ? 'Deny Reason' : 'Policy Decision Note'}
                        </span>
                        <p className="mt-0.5 font-mono text-[11px] text-ink-primary">{evt.reason}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="p-8 text-center font-mono text-xs text-ink-secondary">
              No activity matches the current filters.
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
