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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { formatCurrency, formatTimestamp, formatDateTime } from '@/lib/format';
import type { AgentInstance, AgentClass, ActivityEvent } from '@/lib/types';
import { api } from '@/lib/api';
import { Search, Ban, Shield, Clock, Wrench, Plus, Key, Copy, Check, RefreshCw } from 'lucide-react';

export function AgentsView({
  instances,
  classes,
  activityFeed,
  selectedAgentId,
  onSelectAgent,
  initialFilter,
  onRefresh,
}: {
  instances: AgentInstance[];
  classes: AgentClass[];
  activityFeed: ActivityEvent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
  initialFilter?: { classId?: string; status?: string } | null;
  onRefresh?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<string>(
    initialFilter?.classId ?? 'all'
  );
  const [statusFilter, setStatusFilter] = useState<string>(
    initialFilter?.status ?? 'all'
  );
  const [showCreate, setShowCreate] = useState(false);

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
      {/* Filters & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input
              placeholder="Search by agent ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-border bg-white/[0.02] pl-9 font-mono text-xs placeholder:text-ink-secondary/50"
            />
          </div>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="w-[180px] border-border bg-white/[0.02] font-mono text-xs">
              <SelectValue placeholder="Class" />
            </SelectTrigger>
            <SelectContent className="border-border bg-slate-900 text-white font-mono text-xs">
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
            <SelectContent className="border-border bg-slate-900 text-white font-mono text-xs">
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="revoked">Revoked</SelectItem>
              <SelectItem value="killed">Killed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={() => setShowCreate(true)}
          className="border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 font-mono text-xs"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Register Instance
        </Button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((inst) => {
          const cls = classMap.get(inst.classId);
          return (
            <div key={inst.id} onClick={() => onSelectAgent(inst.id)} className="cursor-pointer">
              <Panel className="transition-colors hover:border-white/20">
              <div className="flex items-start justify-between border-b border-white/5 p-4">
                <div>
                  <div className="font-mono text-sm text-ink-primary font-semibold">{inst.id}</div>
                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                    {cls?.name ?? inst.className ?? inst.classId}
                  </div>
                </div>
                <StatusBadge status={inst.status} />
              </div>

              <div className="p-4 space-y-3">
                <SpendBar used={inst.spendToday} cap={inst.capToday || 5000} />

                <div className="flex items-center justify-between font-mono text-[10px] text-ink-secondary">
                  <span>Last action: {inst.lastAction || 'Idle'}</span>
                  <span>{formatTimestamp(inst.lastSeen)}</span>
                </div>
              </div>
            </Panel>
          </div>
          );
        })}
      </div>

      {/* Instance Detail Drawer */}
      <Sheet open={!!selectedAgent} onOpenChange={(open) => !open && onSelectAgent(null)}>
        <SheetContent className="w-full border-white/10 bg-slate-950 text-white sm:max-w-md overflow-y-auto">
          {selectedAgent && (
            <AgentDetail
              agent={selectedAgent}
              cls={classMap.get(selectedAgent.classId)}
              activityFeed={activityFeed}
              onRevoke={async () => {
                await api.revokeAgent(selectedAgent.id);
                onSelectAgent(null);
                if (onRefresh) onRefresh();
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Create Instance Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest text-ink-primary">
              Register Agent Instance
            </DialogTitle>
          </DialogHeader>
          <CreateInstanceForm
            classes={classes}
            onComplete={() => {
              setShowCreate(false);
              if (onRefresh) onRefresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateInstanceForm({ classes, onComplete }: { classes: AgentClass[]; onComplete: () => void }) {
  const [agentId, setAgentId] = useState('');
  const [classId, setClassId] = useState(classes[0]?.id || '');
  const [mintedToken, setMintedToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const id = agentId.trim().toLowerCase().replace(/\s+/g, '-');
    if (!id || !classId) {
      setError('Please fill in Agent Instance ID and Class.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.registerAgentInstance({
        id,
        class_id: classId,
        status: 'active',
      } as any);

      if (res && (res as any).jwt_token) {
        setMintedToken((res as any).jwt_token);
      } else {
        onComplete();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to register agent instance');
    } finally {
      setLoading(false);
    }
  };

  const copyToken = () => {
    navigator.clipboard.writeText(mintedToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (mintedToken) {
    return (
      <div className="space-y-4 pt-2">
        <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs border border-emerald-500/20 bg-emerald-500/10 p-3 rounded">
          <Key className="h-4 w-4 shrink-0" />
          <span>Agent Instance Registered! JWT Token generated:</span>
        </div>

        <div>
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary mb-1 block">
            Agent JWT Bearer Token (Pass in Authorization Header)
          </Label>
          <textarea
            readOnly
            value={mintedToken}
            className="h-28 w-full border border-white/10 bg-white/5 p-2 font-mono text-[10px] leading-relaxed rounded text-cyan-300 select-all focus:outline-none"
          />
        </div>

        <div className="flex justify-between items-center pt-2">
          <Button
            type="button"
            onClick={copyToken}
            className="bg-cyan-600 text-white hover:bg-cyan-500 font-mono text-xs px-4"
          >
            {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
            {copied ? 'Copied!' : 'Copy JWT Token'}
          </Button>

          <Button
            type="button"
            onClick={onComplete}
            className="bg-white/10 text-white hover:bg-white/20 font-mono text-xs"
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      {error && (
        <div className="border border-rose-500/30 bg-rose-500/10 p-2.5 rounded font-mono text-xs text-rose-400">
          {error}
        </div>
      )}

      <div>
        <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Agent Instance ID</Label>
        <Input
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          placeholder="e.g. login-agent-01"
          className="mt-1 border-white/10 bg-white/5 font-mono text-xs"
          required
        />
      </div>

      <div>
        <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Assigned Agent Class</Label>
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="mt-1 border-white/10 bg-white/5 font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-white/10 bg-slate-900 text-white font-mono text-xs">
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} ({c.id})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end gap-2 pt-3">
        <Button
          type="button"
          variant="outline"
          onClick={onComplete}
          className="border-white/10 bg-transparent text-ink-secondary font-mono text-xs"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={loading}
          className="bg-cyan-600 text-white hover:bg-cyan-500 font-mono text-xs px-5"
        >
          Register & Mint Token
        </Button>
      </div>
    </form>
  );
}

function AgentDetail({
  agent,
  cls,
  activityFeed,
  onRevoke,
}: {
  agent: AgentInstance;
  cls?: AgentClass;
  activityFeed: ActivityEvent[];
  onRevoke: () => void;
}) {
  const [jwtToken, setJwtToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [loadingToken, setLoadingToken] = useState(false);

  const agentActivity = useMemo(
    () => activityFeed.filter((a) => a.agentId === agent.id),
    [activityFeed, agent.id]
  );

  const handleMintToken = async () => {
    setLoadingToken(true);
    try {
      const res = await fetch(`http://localhost:8000/api/v1/tokens?agent_id=${agent.id}&agent_kind=${agent.classId}`, { method: 'POST' });
      const data = await res.json();
      setJwtToken(data.token || '');
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingToken(false);
    }
  };

  const copyToken = () => {
    navigator.clipboard.writeText(jwtToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4 pt-4">
      <SheetHeader>
        <SheetTitle className="font-mono text-sm uppercase tracking-widest text-ink-primary flex items-center justify-between">
          <span>{agent.id}</span>
          <StatusBadge status={agent.status} />
        </SheetTitle>
      </SheetHeader>

      <div className="border-b border-white/5 pb-4">
        <div className="font-mono text-xs text-ink-secondary">
          Class: <span className="text-cyan-400 font-semibold">{cls?.name ?? agent.classId}</span>
        </div>
      </div>

      {/* JWT Bearer Token Controls */}
      <div className="border border-white/10 bg-white/[0.02] p-3 rounded space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-cyan-400 font-semibold flex items-center gap-1.5">
            <Key className="h-3.5 w-3.5" /> Bearer JWT Token
          </span>
          <Button
            size="sm"
            onClick={handleMintToken}
            disabled={loadingToken}
            className="h-6 px-2 text-[10px] font-mono border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20"
          >
            {loadingToken ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Mint Token'}
          </Button>
        </div>

        {jwtToken ? (
          <div className="space-y-2">
            <textarea
              readOnly
              value={jwtToken}
              className="h-20 w-full border border-white/10 bg-white/5 p-1.5 font-mono text-[10px] leading-relaxed rounded text-cyan-300 select-all focus:outline-none"
            />
            <Button
              size="sm"
              onClick={copyToken}
              className="w-full h-7 font-mono text-xs bg-cyan-600 text-white hover:bg-cyan-500"
            >
              {copied ? <Check className="h-3 w-3 mr-1.5" /> : <Copy className="h-3 w-3 mr-1.5" />}
              {copied ? 'Copied to Clipboard!' : 'Copy JWT Token'}
            </Button>
          </div>
        ) : (
          <p className="font-mono text-[10px] text-ink-secondary">
            Click &quot;Mint Token&quot; to generate an authentication token for this agent.
          </p>
        )}
      </div>

      {/* Recent actions */}
      <div className="border-b border-white/5 pb-4">
        <div className="mb-2 flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-ink-secondary" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            Recent Actions
          </span>
        </div>
        {agentActivity.length === 0 ? (
          <p className="font-mono text-[11px] text-ink-secondary">
            No recent activity for this instance.
          </p>
        ) : (
          <div className="space-y-1.5">
            {agentActivity.map((evt) => (
              <div key={evt.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                    evt.decision === 'allow' ? 'bg-emerald-400' : 'bg-rose-500'
                  )}
                />
                <span className="font-mono text-[10px] text-ink-secondary">
                  {formatTimestamp(evt.timestamp)}
                </span>
                <span className="flex-1 truncate font-mono text-xs text-ink-primary font-medium">
                  {evt.action}
                </span>
                <span
                  className={cn(
                    'font-mono text-[10px] uppercase font-semibold',
                    evt.decision === 'allow' ? 'text-emerald-400' : 'text-rose-400'
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
      {agent.status !== 'killed' && agent.status !== 'revoked' && (
        <Button
          variant="outline"
          onClick={onRevoke}
          className="w-full border-rose-500/30 text-rose-400 hover:bg-rose-500/10 font-mono text-xs"
        >
          <Ban className="mr-2 h-4 w-4" />
          Revoke this instance
        </Button>
      )}
    </div>
  );
}
