'use client';

import { useState, useMemo, useEffect } from 'react';
import { cn, copyToClipboard } from '@/lib/utils';
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
import { useToast } from '@/hooks/use-toast';
import type { AgentInstance, AgentClass, ActivityEvent } from '@/lib/types';
import { api } from '@/lib/api';
import { Search, Ban, Shield, Clock, Wrench, Plus, Key, Copy, Check, RefreshCw, Play, Terminal, Trash2 } from 'lucide-react';

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
  const [showGuide, setShowGuide] = useState(false);
  const { toast } = useToast();

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

        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowGuide(true)}
            className="border border-white/10 bg-white/5 text-ink-primary hover:bg-white/10 font-mono text-xs"
          >
            <Terminal className="mr-1.5 h-4 w-4 text-cyan-400" />
            Connection Guide
          </Button>

          <Button
            onClick={() => setShowCreate(true)}
            className="border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 font-mono text-xs"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Register Instance
          </Button>
        </div>
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
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
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={inst.status} />
                    {inst.degraded && (
                      <span
                        title={`Unreachable tools: ${(inst.unreachableTools || []).join(', ') || 'unknown'}`}
                        className="inline-flex items-center rounded-full border border-signal-caution/20 bg-signal-caution/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-signal-caution"
                      >
                        degraded
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <SpendBar used={inst.spendToday} cap={inst.capToday} showLabel />

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
      ) : (
        <Panel className="p-12 text-center">
          <Shield className="mx-auto h-8 w-8 text-ink-secondary/40 mb-3" />
          <h3 className="font-mono text-sm uppercase tracking-widest text-ink-primary font-semibold">
            {instances.length === 0 ? 'No Agent Instances Registered' : 'No Matching Agent Instances'}
          </h3>
          <p className="mt-1 font-sans text-xs text-ink-secondary max-w-sm mx-auto">
            {instances.length === 0
              ? 'Register an agent instance to start monitoring tool calls, enforcing spend caps, and tracking telemetry.'
              : 'Try clearing your search query or adjusting your class and status filters.'}
          </p>
          {instances.length === 0 && (
            <Button
              onClick={() => setShowCreate(true)}
              className="mt-4 border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 font-mono text-xs"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Register First Instance
            </Button>
          )}
        </Panel>
      )}

      {/* Instance Detail Drawer */}
      <Sheet open={!!selectedAgent} onOpenChange={(open) => !open && onSelectAgent(null)}>
        <SheetContent className="w-full border-white/10 bg-slate-950 text-white sm:max-w-md overflow-y-auto">
          {selectedAgent && (
              <AgentDetail
                agent={selectedAgent}
                cls={classMap.get(selectedAgent.classId)}
                activityFeed={activityFeed}
                onRevoke={async () => {
                  try {
                    await api.revokeAgent(selectedAgent.id);
                    toast({ title: 'Agent revoked', description: selectedAgent.id });
                    onSelectAgent(null);
                    if (onRefresh) onRefresh();
                  } catch (err: any) {
                    toast({ variant: 'destructive', title: 'Failed to revoke agent', description: err.message || 'Unknown error' });
                  }
                }}
                onRevive={async () => {
                  try {
                    await api.reviveAgent(selectedAgent.id);
                    toast({ title: 'Agent revived', description: selectedAgent.id });
                    onSelectAgent(null);
                    if (onRefresh) onRefresh();
                  } catch (err: any) {
                    toast({ variant: 'destructive', title: 'Failed to revive agent', description: err.message || 'Unknown error' });
                  }
                }}
                onDelete={async () => {
                  try {
                    await api.deleteAgentInstance(selectedAgent.id);
                    toast({ title: 'Agent deleted', description: selectedAgent.id });
                    onSelectAgent(null);
                    if (onRefresh) onRefresh();
                  } catch (err: any) {
                    toast({ variant: 'destructive', title: 'Failed to delete agent', description: err.message || 'Unknown error' });
                  }
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

      {/* Agent Connection Guide Dialog */}
      <AgentConnectionGuideModal open={showGuide} onOpenChange={setShowGuide} />
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

  const copyToken = async () => {
    const ok = await copyToClipboard(mintedToken);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
            className="h-28 w-full border border-white/10 bg-white/5 p-2 font-mono text-[10px] leading-relaxed rounded text-cyan-300 select-text focus:outline-none"
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
  onRevive,
  onDelete,
}: {
  agent: AgentInstance;
  cls?: AgentClass;
  activityFeed: ActivityEvent[];
  onRevoke: () => void;
  onRevive?: () => void;
  onDelete?: () => void;
}) {
  const [jwtToken, setJwtToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [loadingToken, setLoadingToken] = useState(false);
  const [spendToday, setSpendToday] = useState<number | null>(null);

  const agentActivity = useMemo(
    () => activityFeed.filter((a) => a.agentId === agent.id),
    [activityFeed, agent.id]
  );

  // Fetch the real per-agent spend counter from the backend (previously the
  // endpoint existed but was never called, so the drawer showed no spend data).
  useEffect(() => {
    let cancelled = false;
    api.getAgentSpend(agent.id)
      .then((counters) => {
        if (!cancelled) setSpendToday(counters?.today ?? 0);
      })
      .catch(() => { if (!cancelled) setSpendToday(null); });
    return () => { cancelled = true; };
  }, [agent.id]);

  const handleMintToken = async () => {
    setLoadingToken(true);
    try {
      const res = await fetch(`/api/v1/tokens?agent_id=${agent.id}&agent_kind=${agent.classId}`, { method: 'POST' });
      const data = await res.json();
      setJwtToken(data.token || '');
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingToken(false);
    }
  };

  const copyToken = async () => {
    const ok = await copyToClipboard(jwtToken);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-4 pt-4">
      <SheetHeader>
        <SheetTitle className="font-mono text-sm uppercase tracking-widest text-ink-primary flex items-center justify-between">
          <span>{agent.id}</span>
          <div className="flex items-center gap-2">
            {agent.degraded && (
              <span className="inline-flex items-center rounded-full border border-signal-caution/20 bg-signal-caution/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-signal-caution">
                degraded
              </span>
            )}
            <StatusBadge status={agent.status} />
          </div>
        </SheetTitle>
      </SheetHeader>

      <div className="border-b border-white/5 pb-4 space-y-1.5">
        <div className="font-mono text-xs text-ink-secondary">
          Class: <span className="text-cyan-400 font-semibold">{cls?.name ?? agent.classId}</span>
        </div>
        {agent.degraded && (agent.unreachableTools || []).length > 0 && (
          <div className="font-mono text-[11px] text-signal-caution">
            {(agent.unreachableTools || []).length} tool{(agent.unreachableTools || []).length !== 1 ? 's' : ''} unreachable
            <span className="text-ink-secondary"> — {(agent.unreachableTools || []).join(', ')}</span>
          </div>
        )}
      </div>

      {/* Instance Governance Overrides Summary Card */}
      <div className="border border-white/10 bg-slate-900/90 p-3 rounded space-y-1.5 font-mono text-xs">
        <div className="flex items-center justify-between text-ink-secondary uppercase tracking-widest text-[10px]">
          <span>Instance Governance Overrides</span>
          <span className="text-cyan-400 font-semibold">{agent.id}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-secondary text-[11px]">Spend Today:</span>
          <span className="text-emerald-400 font-bold tabular">
            {spendToday !== null ? formatCurrency(spendToday) : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-secondary text-[11px]">Spend Cap Override:</span>
          <span className="text-emerald-400 font-bold">
            {agent.instanceOverrides?.capOverride?.amount ? `$${agent.instanceOverrides.capOverride.amount}` : 'Inherited from Class'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-secondary text-[11px]">Tool Overrides:</span>
          <span className="text-cyan-300">
            {agent.instanceOverrides?.tools?.length ? `${agent.instanceOverrides.tools.length} custom tools` : 'Inherited from Class'}
          </span>
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
              className="h-20 w-full border border-white/10 bg-white/5 p-1.5 font-mono text-[10px] leading-relaxed rounded text-cyan-300 select-text focus:outline-none"
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

      {/* Connection Info & Snippets */}
      <AgentConnectionSnippet agent={agent} cls={cls} token={jwtToken} />

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

      {/* Instance Lifecycle controls */}
      <div className="space-y-2 pt-2">
        {agent.status !== 'killed' && agent.status !== 'revoked' ? (
          <Button
            variant="outline"
            onClick={onRevoke}
            className="w-full border-amber-500/30 text-amber-400 hover:bg-amber-500/10 font-mono text-xs cursor-pointer"
          >
            <Ban className="mr-2 h-4 w-4" />
            Revoke this instance
          </Button>
        ) : (
          <Button
            onClick={onRevive}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2 py-2.5 shadow-[0_0_15px_-3px_rgba(52,211,153,0.4)]"
          >
            <Play className="h-4 w-4" />
            Start / Reactivate Instance
          </Button>
        )}

        {onDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full border-rose-500/30 text-rose-400 hover:bg-rose-500/10 font-mono text-xs cursor-pointer"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Agent Instance
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-white/10 bg-slate-950 text-white">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-mono text-sm uppercase tracking-widest text-rose-400">
                  Delete Agent Instance '{agent.id}'?
                </AlertDialogTitle>
                <AlertDialogDescription className="font-sans text-xs text-ink-secondary">
                  This will permanently delete this agent instance record. All active sessions and spend tracking keys for this instance will be removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-white/10 bg-transparent text-ink-secondary font-mono text-xs">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-rose-600 text-white hover:bg-rose-500 font-mono text-xs"
                >
                  Delete Instance
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

function AgentConnectionSnippet({ agent, cls, token }: { agent: AgentInstance; cls?: AgentClass; token?: string }) {
  const [activeTab, setActiveTab] = useState<'mcp.json' | 'curl'>('mcp.json');
  const [copied, setCopied] = useState(false);
  const bearer = token || '<YOUR_JWT_TOKEN>';

  // Derive the gateway URL dynamically — in production nginx proxies /mcp to the gateway.
  const gatewayUrl = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_GATEWAY_URL || `${window.location.origin}/mcp`)
    : '/mcp';

  // Pick a sample tool from the agent's allowed tools for the curl example.
  // Arguments are left empty — we don't fabricate fake account IDs / values.
  // The operator fills them in from the tool's real input_schema.
  const allowedTools = agent.tool_overrides?.length
    ? agent.tool_overrides
    : cls?.allowedTools || [];
  const sampleTool = allowedTools[0] || 'get_balance';
  const sampleArgs: Record<string, string> = {};

  const serverName = agent.id.replace(/[^a-zA-Z0-9-_]/g, '-');

  const mcpJsonSnippet = JSON.stringify({
    mcpServers: {
      [serverName]: {
        url: gatewayUrl,
        headers: {
          Authorization: `Bearer ${bearer}`,
          'X-Agent-ID': agent.id,
        },
      },
    },
  }, null, 2);

  const curlSnippet = `curl -X POST ${gatewayUrl} \\
  -H "Authorization: Bearer ${bearer}" \\
  -H "X-Agent-ID: ${agent.id}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '${JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: sampleTool,
      arguments: sampleArgs,
    },
    id: 1,
  }, null, 2)}'`;

  const activeSnippet = activeTab === 'mcp.json' ? mcpJsonSnippet : curlSnippet;

  const copySnippet = async () => {
    const ok = await copyToClipboard(activeSnippet);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="border border-white/10 bg-white/[0.02] p-3 rounded space-y-2 font-mono text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5" /> MCP Server Config & Connection
        </span>
        <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded border border-white/10">
          {(['mcp.json', 'curl'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-mono uppercase transition-colors cursor-pointer',
                activeTab === tab ? 'bg-cyan-500/20 text-cyan-400 font-semibold border border-cyan-500/30' : 'text-ink-secondary hover:text-white'
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <pre className="min-h-[180px] max-h-[320px] overflow-auto bg-slate-950/80 border border-white/10 p-3.5 rounded-lg text-xs font-mono leading-relaxed select-text">
          {activeTab === 'mcp.json' ? renderHighlightedJson(activeSnippet) : activeSnippet}
        </pre>
        <button
          onClick={copySnippet}
          className="absolute top-2.5 right-2.5 bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded transition-colors text-xs cursor-pointer flex items-center gap-1 font-mono border border-white/10 shadow-sm"
          title="Copy Code Snippet"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>

      <div className="text-[10px] text-ink-secondary space-y-0.5 pt-1 font-mono">
        <div>• <strong className="text-white">Gateway Endpoint</strong>: <code className="text-cyan-300">{gatewayUrl}</code></div>
        <div>• <strong className="text-white">Agent ID</strong>: <code className="text-cyan-300">{agent.id}</code></div>
        <div>• <strong className="text-white">Class</strong>: <code className="text-cyan-300">{cls?.name ?? agent.classId}</code></div>
        <div>• <strong className="text-white">Allowed Tools</strong>: <code className="text-cyan-300">{allowedTools.length > 0 ? allowedTools.join(', ') : 'None assigned'}</code></div>
      </div>
    </div>
  );
}

function renderHighlightedJson(jsonStr: string) {
  const bracketColors = ['text-amber-400', 'text-cyan-400', 'text-purple-400', 'text-emerald-400'];
  let depth = 0;

  return jsonStr.split('\n').map((line, lIdx) => {
    // Regex matches strings, brackets, colons, commas
    const tokens = line.split(/("(?:\\.|[^"\\])*"|[{}[\]:,])/g);

    return (
      <div key={lIdx} className="leading-relaxed">
        {tokens.map((token, tIdx) => {
          if (!token) return null;

          if (token === '{' || token === '[') {
            const color = bracketColors[depth % bracketColors.length];
            depth++;
            return (
              <span key={tIdx} className={cn('font-bold text-sm', color)}>
                {token}
              </span>
            );
          }

          if (token === '}' || token === ']') {
            depth = Math.max(0, depth - 1);
            const color = bracketColors[depth % bracketColors.length];
            return (
              <span key={tIdx} className={cn('font-bold text-sm', color)}>
                {token}
              </span>
            );
          }

          if (token.startsWith('"') && token.endsWith('"')) {
            const isKey = line.indexOf(token) < line.indexOf(':') && line.includes(':');
            return (
              <span key={tIdx} className={isKey ? 'text-sky-300 font-semibold' : 'text-emerald-300'}>
                {token}
              </span>
            );
          }

          if (token === ':' || token === ',') {
            return <span key={tIdx} className="text-slate-500 font-bold">{token}</span>;
          }

          return <span key={tIdx} className="text-slate-300">{token}</span>;
        })}
      </div>
    );
  });
}

function AgentConnectionGuideModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-white/10 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-widest text-ink-primary flex items-center gap-2">
            <Terminal className="h-4 w-4 text-cyan-400" />
            Agent Connection & Governance Gateway Guide
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 font-mono text-xs pt-2">
          <div className="border border-cyan-500/20 bg-cyan-500/5 p-3 rounded space-y-1.5 font-sans text-xs text-ink-secondary">
            <p className="font-semibold font-mono text-cyan-300 uppercase tracking-wider text-[11px]">
              How Agent Governance Works:
            </p>
            <p>
              Agents (LangChain, AutoGen, CrewAI, or custom scripts) do NOT connect directly to bank APIs or downstream tools.
              Instead, agents route all tool execution requests through the <strong className="text-white">AGP Governance Proxy</strong>.
            </p>
            <p>
              Every call is authenticated via Bearer JWT token, checked against OPA Rego policies, daily/hourly spend caps,
              and tool parameter constraints before forwarding.
            </p>
          </div>

          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold">
              Complete 3-Step Setup Flow:
            </span>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="border border-white/10 bg-white/[0.02] p-3 rounded">
                <div className="text-cyan-400 font-bold text-xs mb-1 font-mono">1. Bank Connections</div>
                <div className="text-[10px] text-ink-secondary font-sans">Connect native MCP servers or virtualize OpenAPI REST services.</div>
              </div>
              <div className="border border-white/10 bg-white/[0.02] p-3 rounded">
                <div className="text-cyan-400 font-bold text-xs mb-1 font-mono">2. Classes & Policies</div>
                <div className="text-[10px] text-ink-secondary font-sans">Set allowed tools, spend caps, and author OPA Rego governance rules.</div>
              </div>
              <div className="border border-white/10 bg-white/[0.02] p-3 rounded">
                <div className="text-cyan-400 font-bold text-xs mb-1 font-mono">3. Register & Connect</div>
                <div className="text-[10px] text-ink-secondary font-sans">Register agent instance ID, mint JWT token, and point agent to AGP.</div>
              </div>
            </div>
          </div>

          <AgentConnectionSnippet
            agent={{
              id: 'custom-agent-alpha',
              classId: 'your-class-id',
              status: 'active',
              spendToday: 0,
              capToday: 500,
              lastAction: 'Idle',
              lastSeen: 'Just now',
            }}
          />

          <div className="flex justify-end pt-2">
            <Button onClick={() => onOpenChange(false)} className="bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs px-5">
              Got it
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
