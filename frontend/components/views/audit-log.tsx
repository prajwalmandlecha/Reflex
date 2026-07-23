'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Panel } from '@/components/gov/panel';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDateTime, formatTimestamp } from '@/lib/format';
import type { AuditLogEntry } from '@/lib/types';
import { Search, Download, Lock, ArrowRight } from 'lucide-react';

const entryTypeLabel: Record<string, string> = {
  action: 'Action',
  config_change: 'Config Change',
  policy_change: 'Policy Change',
  stop_event: 'Stop Event',
};

const entryTypeColor: Record<string, string> = {
  action: 'text-ink-secondary',
  config_change: 'text-accent',
  policy_change: 'text-accent',
  stop_event: 'text-signal-stopped',
};

export function AuditLogView({ entries }: { entries: AuditLogEntry[] }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !e.agentId.toLowerCase().includes(q) &&
          !e.action.toLowerCase().includes(q) &&
          !(e.reason ?? '').toLowerCase().includes(q) &&
          !(e.operator ?? '').toLowerCase().includes(q)
        )
          return false;
      }
      if (typeFilter !== 'all' && e.entryType !== typeFilter) return false;
      if (outcomeFilter !== 'all' && e.decision !== outcomeFilter) return false;
      return true;
    });
  }, [entries, search, typeFilter, outcomeFilter]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-ink-primary">
            Audit Log
          </h2>
          <p className="font-sans text-xs text-ink-secondary">
            Complete, append-only history of agent actions, config changes, policy changes, and stop events.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            <Lock className="h-3 w-3" />
            Immutable / Append-only
          </div>
          <Button variant="outline" className="border-border text-ink-secondary hover:bg-white/5">
            <Download className="mr-1.5 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
          <Input
            placeholder="Search agent, action, operator, reason…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-white/10 bg-white/[0.02] pl-9 font-mono text-sm placeholder:text-ink-secondary/50"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px] border-white/10 bg-white/[0.02] font-mono text-xs">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent className="border-border bg-white/5">
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="action">Action</SelectItem>
            <SelectItem value="config_change">Config Change</SelectItem>
            <SelectItem value="policy_change">Policy Change</SelectItem>
            <SelectItem value="stop_event">Stop Event</SelectItem>
          </SelectContent>
        </Select>
        <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
          <SelectTrigger className="w-[120px] border-white/10 bg-white/[0.02] font-mono text-xs">
            <SelectValue placeholder="Outcome" />
          </SelectTrigger>
          <SelectContent className="border-border bg-white/5">
            <SelectItem value="all">All outcomes</SelectItem>
            <SelectItem value="allow">Allow</SelectItem>
            <SelectItem value="deny">Deny</SelectItem>
          </SelectContent>
        </Select>
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
          {filtered.length} entries
        </span>
      </div>

      {/* Table */}
      <Panel>
        <div className="max-h-[calc(100vh-280px)] overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-[rgba(14,20,28,0.9)] backdrop-blur-xl">
              <tr className="border-b border-white/5">
                {['Timestamp', 'Type', 'Agent', 'Action', 'Outcome', 'Reason / Change', 'Operator'].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-widest text-ink-secondary"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-white/5 transition-colors hover:bg-white/5"
                >
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px] text-ink-secondary tabular">
                    {formatTimestamp(entry.timestamp)}
                    <div className="text-[9px] text-ink-secondary/60">
                      {formatDateTime(entry.timestamp)}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        'font-mono text-[10px] uppercase tracking-wider',
                        entryTypeColor[entry.entryType || 'action'] || 'text-ink-secondary'
                      )}
                    >
                      {entryTypeLabel[entry.entryType || 'action'] || 'Action'}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-[10px] text-accent">
                    {entry.agentId === '-' ? '—' : entry.agentId}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-primary">
                    {entry.action}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        'font-mono text-[10px] uppercase tracking-wider',
                        entry.decision === 'allow' ? 'text-signal-healthy' : 'text-signal-stopped'
                      )}
                    >
                      {entry.decision}
                    </span>
                  </td>
                  <td className="max-w-[300px] px-4 py-2 font-sans text-[11px] text-ink-secondary">
                    {entry.reason}
                    {entry.oldValue && entry.newValue && (
                      <div className="mt-0.5 flex items-center gap-1 font-mono text-[10px]">
                        <span className="text-signal-stopped">{entry.oldValue}</span>
                        <ArrowRight className="h-3 w-3 text-ink-secondary" />
                        <span className="text-signal-healthy">{entry.newValue}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-[10px] text-ink-secondary">
                    {entry.operator ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="p-8 text-center font-mono text-xs text-ink-secondary">
              No audit entries match the current filters.
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
