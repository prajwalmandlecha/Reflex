'use client';

import { useState, useMemo, useEffect } from 'react';
import { cn, copyToClipboard } from '@/lib/utils';
import { Panel } from '@/components/gov/panel';
import { StatusBadge } from '@/components/gov/status-badge';
import { SpendBar } from '@/components/gov/spend-bar';
import {
  Dialog,
  DialogClose,
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
import { useAuth } from '@/lib/auth-context';
import { Search, Ban, Shield, Clock, Wrench, Plus, Key, Copy, Check, RefreshCw, Play, Terminal, Trash2, X, Eye } from 'lucide-react';

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
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('instances:create');
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

          {canCreate && (
            <Button
              onClick={() => setShowCreate(true)}
              className="border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 font-mono text-xs"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Register Instance
            </Button>
          )}
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

                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between font-mono text-[10px] text-ink-secondary border-b border-white/5 pb-2">
                    <span>Tool Governance:</span>
                    <span className="text-cyan-400 font-semibold uppercase tracking-wider">
                      {inst.tool_overrides !== null && inst.tool_overrides !== undefined
                        ? `${inst.tool_overrides.length} tools (Scoped)`
                        : 'Class Inherited'}
                    </span>
                  </div>

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
      <Dialog open={!!selectedAgent} onOpenChange={(open) => !open && onSelectAgent(null)}>
        <DialogContent hideClose className="max-w-4xl border-white/10 bg-slate-950 text-white p-0 gap-0 overflow-hidden">
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
                onRefresh={onRefresh}
              />
          )}
        </DialogContent>
      </Dialog>

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
  const [classId, setClassId] = useState(classes[0]?.id || '');
  const [mintedToken, setMintedToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedClass = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  const classTools = useMemo(
    () => selectedClass?.allowedTools || selectedClass?.defaultAllowedTools || [],
    [selectedClass]
  );
  const [selectedTools, setSelectedTools] = useState<string[]>(classTools);
  const [useScopeDown, setUseScopeDown] = useState(false);

  useEffect(() => {
    setSelectedTools(classTools);
  }, [classTools]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // id is derived by the backend from the class name + a short random suffix.
    if (!classId) {
      setError('Please select a Class.');
      return;
    }

    setLoading(true);
    try {
      const toolOverrides = useScopeDown ? selectedTools : null;
      const res = await api.registerAgentInstance({
        class_id: classId,
        status: 'active',
        tool_overrides: toolOverrides,
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
            className="bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-mono text-xs font-semibold px-4 h-8"
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

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary flex items-center gap-1.5">
            <Wrench className="h-3 w-3 text-cyan-400" />
            Tool Governance (Scoped Down)
          </Label>
          <button
            type="button"
            onClick={() => {
              if (!useScopeDown) setSelectedTools(classTools);
              setUseScopeDown(!useScopeDown);
            }}
            className="font-mono text-[10px] text-cyan-400 hover:underline"
          >
            {useScopeDown ? 'Reset to Inherit All' : 'Scope Down Tools'}
          </button>
        </div>

        {useScopeDown ? (
          <div className="border border-white/10 bg-white/5 p-3 rounded space-y-2">
            <p className="font-mono text-[10px] text-ink-secondary">
              Select allowed tools from class permissions ({classTools.length} available):
            </p>
            {classTools.length === 0 ? (
              <p className="font-mono text-[11px] text-amber-400/80">No tools configured on parent class.</p>
            ) : (
              <>
                {selectedTools.length === 0 && (
                  <p className="border border-rose-500/20 bg-rose-500/10 p-1.5 rounded font-mono text-[10px] text-rose-400">
                    ⚠️ 0 tools selected: this instance will be blocked from calling any tool.
                  </p>
                )}
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {classTools.map((tool) => (
                  <label key={tool} className="flex items-center gap-2 cursor-pointer font-mono text-xs text-white">
                    <input
                      type="checkbox"
                      checked={selectedTools.includes(tool)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTools([...selectedTools, tool]);
                        } else {
                          setSelectedTools(selectedTools.filter((t) => t !== tool));
                        }
                      }}
                      className="rounded border-white/20 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                    />
                    <span className={selectedTools.includes(tool) ? 'text-cyan-300' : 'text-ink-secondary line-through'}>
                      {tool}
                    </span>
                  </label>
                ))}
              </div>
              </>
            )}
          </div>
        ) : (
          <div className="border border-white/10 bg-white/[0.02] p-2.5 rounded font-mono text-[11px] text-ink-secondary flex items-center justify-between">
            <span>Inheriting all {classTools.length} tool(s) from class</span>
            <span className="text-emerald-400 text-[10px] uppercase tracking-wider font-semibold">Full Inheritance</span>
          </div>
        )}
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
          className="bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-mono text-xs font-semibold px-5 h-8"
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
  onRefresh,
}: {
  agent: AgentInstance;
  cls?: AgentClass;
  activityFeed: ActivityEvent[];
  onRevoke: () => void;
  onRevive?: () => void;
  onDelete?: () => void;
  onRefresh?: () => void;
}) {
  const { hasPermission } = useAuth();
  const canMint = hasPermission('instances:mint_token');
  const canUpdate = hasPermission('instances:update');
  const canRevoke = hasPermission('instances:revoke');
  const canRevive = hasPermission('instances:revive');

  const { toast } = useToast();
  const [jwtToken, setJwtToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [loadingToken, setLoadingToken] = useState(false);


  const classTools = useMemo(() => cls?.allowedTools || cls?.defaultAllowedTools || [], [cls]);
  const isCustomized = agent.tool_overrides !== null && agent.tool_overrides !== undefined;

  const [editingTools, setEditingTools] = useState(false);
  const [activeTools, setActiveTools] = useState<string[]>(
    isCustomized ? (agent.tool_overrides || []).filter((t) => classTools.includes(t)) : classTools
  );
  const [savingTools, setSavingTools] = useState(false);

  useEffect(() => {
    const isOverridden = agent.tool_overrides !== null && agent.tool_overrides !== undefined;
    setActiveTools(isOverridden ? (agent.tool_overrides || []).filter((t) => classTools.includes(t)) : classTools);
  }, [agent.tool_overrides, classTools]);

  const handleSaveToolOverrides = async (overrideValue: string[] | null) => {
    setSavingTools(true);
    try {
      await api.updateAgentInstance(agent.id, { tool_overrides: overrideValue });
      toast({
        title: 'Tool Governance Updated',
        description:
          overrideValue === null
            ? `Reset ${agent.id} to inherit all class tools.`
            : `Scoped down ${agent.id} to ${overrideValue.length} tool(s).`,
      });
      setEditingTools(false);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Failed to update tool governance',
        description: err.message || 'Unknown error',
      });
    } finally {
      setSavingTools(false);
    }
  };

  const agentActivity = useMemo(
    () => activityFeed.filter((a) => a.agentId === agent.id),
    [activityFeed, agent.id]
  );



  const handleMintToken = async () => {
    setLoadingToken(true);
    try {
      const data = await api.mintToken(agent.id, agent.classId);
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
    <div className="flex flex-col">
      {/* Modal header */}
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-base font-semibold text-ink-primary">{agent.id}</span>
          <span className="font-mono text-xs text-ink-secondary">
            Class: <span className="text-cyan-400 font-semibold">{cls?.name ?? agent.classId}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {agent.degraded && (
            <span className="inline-flex items-center rounded-full border border-signal-caution/20 bg-signal-caution/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-signal-caution">
              degraded
            </span>
          )}
          <StatusBadge status={agent.status} />
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-ink-secondary hover:text-white hover:bg-white/10"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>
        </div>
      </div>

      {agent.degraded && (agent.unreachableTools || []).length > 0 && (
        <div className="border-b border-white/5 px-6 py-2 font-mono text-[11px] text-signal-caution">
          {(agent.unreachableTools || []).length} tool{(agent.unreachableTools || []).length !== 1 ? 's' : ''} unreachable
          <span className="text-ink-secondary"> — {(agent.unreachableTools || []).join(', ')}</span>
        </div>
      )}

      {/* Single-column body */}
      <div className="space-y-4 p-6 overflow-y-auto max-h-[70vh]">
      {/* JWT Bearer Token Controls */}
      <div className="border border-white/10 bg-white/[0.02] p-3 rounded space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-cyan-400 font-semibold flex items-center gap-1.5">
            <Key className="h-3.5 w-3.5" /> Bearer JWT Token
          </span>
          {canMint && (
            <Button
              size="sm"
              onClick={handleMintToken}
              disabled={loadingToken}
              className="h-6 px-2 text-[10px] font-mono border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20"
            >
              {loadingToken ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Mint Token'}
            </Button>
          )}
        </div>

        {jwtToken ? (
          <div className="space-y-2">
            <textarea
              readOnly
              value={jwtToken}
              className="h-20 w-full border border-white/10 bg-white/5 p-1.5 font-mono text-[10px] leading-relaxed rounded text-cyan-300 select-text focus:outline-none whitespace-pre-wrap break-all resize-none"
            />
            <Button
              size="sm"
              onClick={copyToken}
              className="w-full h-8 font-mono text-xs bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
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

      {/* Instance Governance Overrides & Tool Control Card */}
      <div className="border border-white/10 bg-slate-900/90 p-3.5 rounded space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-white/5 pb-2 text-ink-secondary uppercase tracking-widest text-[10px]">
          <span className="flex items-center gap-1.5 text-cyan-400 font-semibold">
            <Wrench className="h-3.5 w-3.5" /> Tool Governance (Scoped Down)
          </span>
          <span className="text-[10px] text-ink-secondary">{agent.id}</span>
        </div>



        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-ink-secondary text-[11px]">Active Instance Tools:</span>
            <span
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border',
                isCustomized
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              )}
            >
              {isCustomized
                ? `Scoped Down (${(agent.tool_overrides || []).length}/${classTools.length})`
                : 'Inherited from Class'}
            </span>
          </div>

          {editingTools ? (
            <div className="border border-cyan-500/30 bg-slate-950 p-2.5 rounded space-y-2.5 mt-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-ink-secondary">Select allowed tools from Class permissions:</span>
                <Button
                  size="sm"
                  type="button"
                  onClick={() => handleSaveToolOverrides(null)}
                  disabled={savingTools}
                  className="h-5 px-2 text-[9px] font-mono border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                >
                  Reset to Inherit All
                </Button>
              </div>

              {classTools.length === 0 ? (
                <p className="font-mono text-[11px] text-amber-400/80">No tools configured on parent class.</p>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {classTools.map((tool) => (
                    <label key={tool} className="flex items-center gap-2 cursor-pointer font-mono text-xs text-white">
                      <input
                        type="checkbox"
                        checked={activeTools.includes(tool)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setActiveTools([...activeTools, tool]);
                          } else {
                            setActiveTools(activeTools.filter((t) => t !== tool));
                          }
                        }}
                        className="rounded border-white/20 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                      />
                      <span className={activeTools.includes(tool) ? 'text-cyan-300' : 'text-ink-secondary line-through'}>
                        {tool}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1 border-t border-white/10">
                <Button
                  size="sm"
                  type="button"
                  onClick={() => setEditingTools(false)}
                  className="h-6 px-2 text-[10px] font-mono border border-white/10 bg-transparent text-ink-secondary"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  type="button"
                  disabled={savingTools}
                  onClick={() => handleSaveToolOverrides(activeTools)}
                  className="h-7 px-3 text-[10px] font-mono bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-semibold"
                >
                  {savingTools ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : null}
                  Apply Scoped Down Tools
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 mt-1">
              <div className="flex flex-wrap gap-1">
                {classTools.length === 0 ? (
                  <span className="font-mono text-[11px] text-ink-secondary">No tools on parent class</span>
                ) : (
                  classTools.map((tool) => {
                    const isEnabled = !isCustomized || (agent.tool_overrides || []).includes(tool);
                    return (
                      <span
                        key={tool}
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] border',
                          isEnabled
                            ? 'bg-white/5 text-cyan-300 border-white/10'
                            : 'bg-white/[0.02] text-ink-secondary/50 border-white/5 line-through'
                        )}
                      >
                        {isEnabled ? (
                          <Check className="h-2.5 w-2.5 text-emerald-400" />
                        ) : (
                          <Ban className="h-2.5 w-2.5 text-rose-400" />
                        )}
                        {tool}
                      </span>
                    );
                  })
                )}
              </div>

              {canUpdate && (
                <Button
                  size="sm"
                  type="button"
                  onClick={() => setEditingTools(true)}
                  className="w-full h-7 font-mono text-[11px] border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 mt-2"
                >
                  <Wrench className="h-3 w-3 mr-1.5" />
                  Edit Tool Governance
                </Button>
              )}
            </div>
          )}
        </div>
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

      {/* Instance Lifecycle controls */}
      <div className="space-y-2 pt-2">
        {agent.status !== 'killed' && agent.status !== 'revoked' ? (
          canRevoke && (
            <Button
              variant="outline"
              onClick={onRevoke}
              className="w-full border-amber-500/30 text-amber-400 hover:bg-amber-500/10 font-mono text-xs cursor-pointer"
            >
              <Ban className="mr-2 h-4 w-4" />
              Revoke this instance
            </Button>
          )
        ) : (
          canRevive && (
            <Button
              onClick={onRevive}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2 py-2.5 shadow-[0_0_15px_-3px_rgba(52,211,153,0.4)]"
            >
              <Play className="h-4 w-4" />
              Start / Reactivate Instance
            </Button>
          )
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
      </div>{/* end single-column body */}
    </div>
  );
}

function AgentConnectionSnippet({ agent, cls, token }: { agent: AgentInstance; cls?: AgentClass; token?: string }) {
  const [activeTab, setActiveTab] = useState<'mcp.json' | 'curl'>('mcp.json');
  const [copied, setCopied] = useState(false);
  const bearer = token || '<YOUR_JWT_TOKEN>';

  // Gateway serves /mcp directly on its own port (no reverse proxy in front).
  // Override with NEXT_PUBLIC_GATEWAY_URL if the gateway is on a different host.
  // The gateway's MCP endpoint is always at /mcp — append it if the configured
  // base URL doesn't already include it (the fallback below already has it).
  const gatewayBase = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_GATEWAY_URL || `${window.location.protocol}//${window.location.hostname}:8080`)
    : 'http://localhost:8080';
  const gatewayUrl = gatewayBase.endsWith('/mcp')
    ? gatewayBase
    : `${gatewayBase.replace(/\/+$/, '')}/mcp`;

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
        },
      },
    },
  }, null, 2);

  const curlSnippet = `curl -X POST ${gatewayUrl} \\
  -H "Authorization: Bearer ${bearer}" \\
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
        <pre className="min-h-[180px] max-h-[320px] overflow-auto bg-slate-950/80 border border-white/10 p-3.5 rounded-lg text-xs font-mono leading-relaxed select-text whitespace-pre-wrap break-all">
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

      <div className="text-[10px] text-ink-secondary space-y-1.5 pt-1 font-mono">
        <div className="break-all">• <strong className="text-white">Gateway Endpoint</strong>: <code className="text-cyan-300">{gatewayUrl}</code></div>
        <div className="break-all">• <strong className="text-white">Agent ID</strong>: <code className="text-cyan-300">{agent.id}</code></div>
        <div className="break-all">• <strong className="text-white">Class</strong>: <code className="text-cyan-300">{cls?.name ?? agent.classId}</code></div>
        <div className="flex items-start gap-1 flex-wrap">
          <strong className="text-white shrink-0">• Allowed Tools:</strong>
          {allowedTools.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {allowedTools.map((tool) => (
                <code key={tool} className="rounded bg-white/5 border border-white/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
                  {tool}
                </code>
              ))}
            </div>
          ) : (
            <code className="text-cyan-300">None assigned</code>
          )}
        </div>
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
              lastAction: 'Idle',
              lastSeen: 'Just now',
            }}
          />

          <div className="flex justify-end pt-2">
            <Button onClick={() => onOpenChange(false)} className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-xs font-semibold px-5 h-8">
              Got it
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
