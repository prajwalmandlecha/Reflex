'use client';

import { useState, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Panel } from '@/components/gov/panel';
import { StatusBadge } from '@/components/gov/status-badge';
import { SpendBar } from '@/components/gov/spend-bar';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatRelative, formatTimestamp, formatDateTime } from '@/lib/format';
import type { AgentInstance, AgentClass, ActivityEvent } from '@/lib/types';
import { Search, Ban, Shield, Clock, Wrench } from 'lucide-react';

export function AgentsView({
  instances,
  classes,
  activityFeed,
  selectedAgentId,
  onSelectAgent,
  initialFilter,
}: {
  instances: AgentInstance[];
  classes: AgentClass[];
  activityFeed: ActivityEvent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
  initialFilter?: { classId?: string; status?: string } | null;
}) {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<string>(
    initialFilter?.classId ?? 'all'
  );
  const [statusFilter, setStatusFilter] = useState<string>(
    initialFilter?.status ?? 'all'
  );

  useEffect(() => {
    if (initialFilter?.classId) setClassFilter(initialFilter.classId);
    if (initialFilter?.status) setStatusFilter(initialFilter.status);
  }, [initialFilter]);

  const classMap = useMemo(
    () => new Map(classes.map((c) => [c.id, c])),
    [classes]
  );

  const filtered = useMemo(() => {
    return instances.filter((inst) => {
      if (search && !inst.id.toLowerCase().includes(search.toLowerCase())) return false;
      if (classFilter !== 'all' && inst.classId !== classFilter) return false;
      if (statusFilter !== 'all' && inst.status !== statusFilter) return false;
      return true;
    });
  }, [instances, search, classFilter, statusFilter]);

  const selectedAgent = instances.find((i) => i.id === selectedAgentId) ?? null;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
          <Input
            placeholder="Search by agent ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-border bg-white/[0.02] pl-9 font-mono text-sm placeholder:text-ink-secondary/50"
          />
        </div>
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-[200px] border-border bg-white/[0.02] font-mono text-xs">
            <SelectValue placeholder="Class" />
          </SelectTrigger>
          <SelectContent className="border-border bg-white/5">
            <SelectItem value="all">All classes</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] border-border bg-white/[0.02] font-mono text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="border-border bg-white/5">
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
            <SelectItem value="killed">Killed</SelectItem>
          </SelectContent>
        </Select>
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
          {filtered.length} of {instances.length} agents
        </span>
      </div>

      {/* Table */}
      <Panel>
        <div className="overflow-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Agent ID', 'Class', 'Status', 'Spend / Cap', 'Last Action', 'Last Seen', ''].map(
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
              {filtered.map((inst) => {
                const cls = classMap.get(inst.classId);
                return (
                  <tr
                    key={inst.id}
                    onClick={() => onSelectAgent(inst.id)}
                    className="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/5"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-accent">{inst.id}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-primary">
                      {cls?.name ?? inst.classId}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={inst.status} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <SpendBar used={inst.spendToday} cap={inst.capToday} className="w-24" />
                        <span className="font-mono text-[10px] text-ink-secondary tabular">
                          {formatCurrency(inst.spendToday)}/{formatCurrency(inst.capToday)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-primary">
                      {inst.lastAction}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-secondary">
                      {formatRelative(inst.lastSeen)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                        View →
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="p-8 text-center font-mono text-xs text-ink-secondary">
              No agents match the current filters.
            </div>
          )}
        </div>
      </Panel>

      {/* Detail drawer */}
      <Sheet open={!!selectedAgent} onOpenChange={(open) => !open && onSelectAgent(null)}>
        <SheetContent
          side="right"
          className="w-[480px] max-w-[90vw] overflow-auto border-white/10 bg-[rgba(14,20,28,0.85)] p-0 backdrop-blur-xl"
        >
          {selectedAgent && (
            <AgentDetail
              agent={selectedAgent}
              cls={classMap.get(selectedAgent.classId)}
              activityFeed={activityFeed}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AgentDetail({
  agent,
  cls,
  activityFeed,
}: {
  agent: AgentInstance;
  cls?: AgentClass;
  activityFeed: ActivityEvent[];
}) {
  const agentActivity = activityFeed.filter((e) => e.agentId === agent.id).slice(0, 12);
  const effectiveTools = agent.instanceOverrides?.tools ?? cls?.allowedTools ?? [];
  const effectiveCap = agent.instanceOverrides?.capOverride ?? cls?.defaultCap;

  return (
    <div className="flex flex-col">
      <SheetHeader className="border-b border-white/5 p-4">
        <SheetTitle className="font-mono text-sm uppercase tracking-widest text-ink-primary">
          {agent.id}
        </SheetTitle>
        <div className="flex items-center gap-2">
          <StatusBadge status={agent.status} size="md" />
          <span className="font-mono text-xs text-ink-secondary">{cls?.name}</span>
        </div>
      </SheetHeader>

      {/* Spend */}
      <div className="border-b border-white/5 p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
          Spend Today
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-xl text-ink-primary tabular">
            {formatCurrency(agent.spendToday)}
          </span>
          <span className="font-mono text-xs text-ink-secondary tabular">
            / {formatCurrency(agent.capToday)} cap
          </span>
        </div>
        <div className="mt-2">
          <SpendBar used={agent.spendToday} cap={agent.capToday} />
        </div>
        {agent.instanceOverrides?.capOverride && (
          <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px] text-signal-caution">
            <Shield className="h-3 w-3" />
            Instance cap override: {formatCurrency(agent.instanceOverrides.capOverride.amount)} / {agent.instanceOverrides.capOverride.window}
          </div>
        )}
      </div>

      {/* Effective permissions */}
      <div className="border-b border-white/5 p-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
          Effective Permissions
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5 text-ink-secondary" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
              Allowed Tools
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 pl-5">
            {effectiveTools.map((tool) => (
              <span
                key={tool}
                className="border border-border bg-white/5 px-2 py-0.5 font-mono text-[10px] text-ink-primary"
              >
                {tool}
              </span>
            ))}
          </div>
          {agent.instanceOverrides?.tools && (
            <div className="pl-5 font-mono text-[10px] text-signal-caution">
              Override applied — class default has {cls?.allowedTools.length ?? 0} tools
            </div>
          )}
        </div>
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
              Class Default Cap
            </span>
            <span className="font-mono text-xs text-ink-secondary tabular">
              {cls ? formatCurrency(cls.defaultCap.amount) : '—'} / {cls?.defaultCap.window}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
              Instance Cap
            </span>
            <span className="font-mono text-xs text-ink-primary tabular">
              {formatCurrency(effectiveCap?.amount ?? 0)} / {effectiveCap?.window}
            </span>
          </div>
        </div>
      </div>

      {/* Recent actions */}
      <div className="border-b border-white/5 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-ink-secondary" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            Recent Actions
          </span>
        </div>
        {agentActivity.length === 0 ? (
          <p className="pl-5 font-mono text-[11px] text-ink-secondary">
            No recent activity for this instance.
          </p>
        ) : (
          <div className="space-y-1.5">
            {agentActivity.map((evt) => (
              <div key={evt.id} className="flex items-center gap-2 pl-5">
                <span
                  className={cn(
                    'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                    evt.decision === 'allow' ? 'bg-signal-healthy' : 'bg-signal-stopped'
                  )}
                />
                <span className="font-mono text-[10px] text-ink-secondary">
                  {formatTimestamp(evt.timestamp)}
                </span>
                <span className="flex-1 truncate font-mono text-xs text-ink-primary">
                  {evt.action}
                </span>
                <span
                  className={cn(
                    'font-mono text-[10px] uppercase',
                    evt.decision === 'allow' ? 'text-signal-healthy' : 'text-signal-stopped'
                  )}
                >
                  {evt.decision}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Revoke control */}
      {agent.status !== 'killed' && (
        <div className="p-4">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full border-signal-stopped/30 text-signal-stopped hover:bg-signal-stopped/10 hover:text-signal-stopped"
              >
                <Ban className="mr-2 h-4 w-4" />
                Revoke this instance
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-white/10 bg-white/[0.02]">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-mono text-sm uppercase tracking-widest">
                  Revoke {agent.id}?
                </AlertDialogTitle>
                <AlertDialogDescription className="font-sans text-sm text-ink-secondary">
                  This will immediately revoke the instance. All pending actions will be denied.
                  The instance can be reactivated from the Emergency Stop page.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-border bg-transparent text-ink-secondary">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction className="bg-signal-stopped text-white hover:bg-signal-stopped/90">
                  Revoke instance
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      <div className="p-4 pt-0">
        <div className="font-mono text-[10px] text-ink-secondary">
          Last seen: {formatDateTime(agent.lastSeen)}
        </div>
      </div>
    </div>
  );
}
