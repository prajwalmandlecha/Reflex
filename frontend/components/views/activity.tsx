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
import { Search, ChevronDown, ChevronRight, Activity, Terminal, Shield, Zap } from 'lucide-react';

export function ActivityView({
  activityFeed,
  classes,
  isStreamConnected = false,
}: {
  activityFeed: ActivityEvent[];
  classes: AgentClass[];
  isStreamConnected?: boolean;
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
      if (classFilter !== 'all' && ((evt as any).agent_class_id || evt.agentClass) !== classFilter)
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
          <h2 className="font-mono text-sm uppercase tracking-widest text-ink-primary font-semibold">
            Real-Time Activity & Payload Stream
          </h2>
          <p className="font-sans text-xs text-ink-secondary">
            Live stream of tool executions, argument payloads, latency traces, and governance decisions across the fleet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Bound to the real /ws/activity socket state — not a hardcoded pulse */}
          <span
            className={cn(
              'flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest font-semibold',
              isStreamConnected
                ? 'border-signal-healthy/20 bg-signal-healthy/10 text-signal-healthy'
                : 'border-signal-caution/20 bg-signal-caution/10 text-signal-caution'
            )}
          >
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 animate-pulse rounded-full',
                isStreamConnected ? 'bg-signal-healthy' : 'bg-signal-caution'
              )}
            />
            {isStreamConnected ? 'Live Pulse · Stream Active' : 'Stream Disconnected · Polling'}
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
          <SelectContent className="border-border bg-slate-900 text-white">
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
          <SelectContent className="border-border bg-slate-900 text-white">
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
            const overheadRaw = (evt as any).governance_overhead_ms;
            const overhead = typeof overheadRaw === 'number' ? overheadRaw : null;
            const action = evt.action || (evt as any).tool || '—';
            const denyStage = (evt as any).deny_stage || 'policy_engine';
            const isDeny = evt.decision === 'deny';

            return (
              <div
                key={evt.id}
                className="border-b border-white/5 last:border-0"
              >
                <div
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/5"
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
                  <span className="shrink-0 font-mono text-xs text-accent font-medium">{agentId}</span>
                  <span className="flex-1 truncate font-mono text-xs text-ink-primary font-semibold">
                    {action}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 font-mono text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-sm border',
                      evt.decision === 'allow'
                        ? 'bg-signal-healthy/10 text-signal-healthy border-signal-healthy/30'
                        : 'bg-signal-stopped/10 text-signal-stopped border-signal-stopped/30'
                    )}
                  >
                    {evt.decision}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-secondary tabular">
                    {latency}ms
                  </span>
                </div>

                {isExpanded && (
                  <div className="animate-feed-slide bg-bg-deep px-4 py-3 pl-10 border-t border-white/5">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px] mb-3">
                      <div>
                        <span className="text-ink-secondary">Agent Instance: </span>
                        <span className="text-ink-primary font-medium">{agentId}</span>
                      </div>
                      <div>
                        <span className="text-ink-secondary">Agent Class: </span>
                        <span className="text-ink-primary font-medium">{agentClass}</span>
                      </div>
                      <div>
                        <span className="text-ink-secondary">Target MCP Connection: </span>
                        <span className="text-ink-primary font-medium">{bankConn}</span>
                      </div>
                      <div>
                        <span className="text-ink-secondary">Latency Breakdown: </span>
                        <span className="text-ink-primary font-medium">
                          Total: {latency}ms (Gateway Overhead: {overhead !== null ? `${overhead}ms` : '—'})
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Terminal className="h-3 w-3 text-cyan-400" />
                          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary font-semibold">
                            Input Argument Payload
                          </span>
                        </div>
                        <pre className="h-[130px] overflow-auto border border-white/10 bg-slate-950 p-2 font-mono text-[11px] text-ink-primary rounded">
                          {JSON.stringify(evt.params || {}, null, 2)}
                        </pre>
                      </div>

                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Zap className="h-3 w-3 text-emerald-400" />
                          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary font-semibold">
                            Tool Execution Response Payload
                          </span>
                        </div>
                        <pre className="h-[130px] overflow-auto border border-white/10 bg-slate-950 p-2 font-mono text-[11px] text-emerald-300 rounded">
                          {(() => {
                            const respData = evt.responseData || evt.response_data || (evt as any).result;
                            if (respData) {
                              return typeof respData === 'string' ? respData : JSON.stringify(respData, null, 2);
                            }
                            return isDeny
                              ? JSON.stringify({ allow: false, reason: evt.reason || 'denied by policy' }, null, 2)
                              : JSON.stringify({ status: 'completed', info: 'Execution returned success' }, null, 2);
                          })()}
                        </pre>
                      </div>

                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Shield className="h-3 w-3 text-accent" />
                          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary font-semibold">
                            Governance Decision & Reason
                          </span>
                        </div>
                        <div
                          className={cn(
                            'h-[130px] overflow-auto border p-2 font-mono text-xs rounded',
                            isDeny
                              ? 'border-signal-stopped/30 bg-signal-stopped/5'
                              : 'border-signal-healthy/30 bg-signal-healthy/5'
                          )}
                        >
                          <div className="flex items-center justify-between pb-1 border-b border-white/5 mb-1.5">
                            <span
                              className={cn(
                                'font-mono text-[10px] uppercase tracking-widest font-bold',
                                isDeny ? 'text-signal-stopped' : 'text-signal-healthy'
                              )}
                            >
                              {isDeny ? `BLOCKED AT STAGE: ${denyStage.toUpperCase()}` : 'ALLOWED BY GOVERNANCE POLICY'}
                            </span>
                          </div>
                          <p className="font-mono text-[11px] text-ink-primary leading-relaxed">
                            {evt.reason || (isDeny ? 'Action denied by security constraints' : 'Executed successfully across gateway proxy.')}
                          </p>
                        </div>
                      </div>
                    </div>
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
