'use client';

import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Panel } from '@/components/gov/panel';
import { StatusBadge } from '@/components/gov/status-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { formatCurrency } from '@/lib/format';
import type { AgentClass, AgentInstance, BankTool } from '@/lib/types';
import { api } from '@/lib/api';
import { Plus, Ban, Wrench, DollarSign, Clock, Settings2, Search, X, CheckCircle2, Trash2 } from 'lucide-react';

export function AgentClassesView({
  classes,
  instances,
  onRefresh,
}: {
  classes: AgentClass[];
  instances: AgentInstance[];
  onRefresh?: () => void;
}) {
  const [editClass, setEditClass] = useState<AgentClass | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-ink-primary">
            Agent Classes
          </h2>
          <p className="font-sans text-xs text-ink-secondary">
            Define default permissions, constraints, and spend caps for groups of agents.
          </p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 font-mono text-xs"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          New class
        </Button>
      </div>

      {classes.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {classes.map((cls) => {
            const clsInstances = instances.filter((i) => i.classId === cls.id);
            const activeCount = clsInstances.filter((i) => i.status === 'active').length;
            return (
              <Panel key={cls.id}>
                <div className="border-b border-white/5 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <button
                        onClick={() => setEditClass(cls)}
                        className="font-mono text-sm text-ink-primary hover:text-accent font-semibold"
                      >
                        {cls.name}
                      </button>
                      <p className="mt-0.5 font-sans text-xs text-ink-secondary">
                        {cls.description}
                      </p>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                      {activeCount}/{cls.instanceCount || clsInstances.length} active
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-px bg-white/5">
                  <div className="bg-white/[0.02] p-3">
                    <div className="flex items-center gap-1.5">
                      <Wrench className="h-3 w-3 text-ink-secondary" />
                      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                        Allowed Tools
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(cls.allowedTools || cls.defaultAllowedTools || []).map((t) => (
                        <span
                          key={t}
                          className="border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-400 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="bg-white/[0.02] p-3">
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="h-3 w-3 text-ink-secondary" />
                      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                        Hourly Cap
                      </span>
                    </div>
                    <div className="mt-1.5 font-mono text-xs text-ink-primary tabular font-medium">
                      {cls.defaultCap?.amount > 0
                        ? `${formatCurrency(cls.defaultCap.amount)}`
                        : 'No spend cap'}
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/5 p-3">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3 text-ink-secondary" />
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                      Configured Constraints
                    </span>
                  </div>
                  <div className="mt-1.5 space-y-1 max-h-28 overflow-y-auto pr-1">
                    {Object.entries(cls.defaultConstraints || {}).length > 0 ? (
                      Object.entries(cls.defaultConstraints || {}).map(([toolName, ruleObj]) => (
                        <div key={toolName} className="font-mono text-[10px] border border-white/5 bg-white/[0.02] p-1 rounded">
                          <span className="text-cyan-400 font-semibold">{toolName}: </span>
                          <span className="text-ink-secondary">{JSON.stringify(ruleObj)}</span>
                        </div>
                      ))
                    ) : (
                      <span className="font-mono text-[10px] text-ink-secondary">No custom constraints set.</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-white/5 p-3">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      onClick={() => setEditClass(cls)}
                      className="font-mono text-[10px] uppercase tracking-widest text-accent hover:bg-accent/10"
                    >
                      <Settings2 className="mr-1 h-3 w-3" /> Edit class
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          className="font-mono text-[10px] uppercase tracking-widest text-rose-400 hover:bg-rose-500/10"
                        >
                          <Trash2 className="mr-1 h-3 w-3" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="border-white/10 bg-slate-950 text-white">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="font-mono text-sm uppercase tracking-widest text-rose-400">
                            Delete Agent Class '{cls.name}'?
                          </AlertDialogTitle>
                          <AlertDialogDescription className="font-sans text-xs text-ink-secondary">
                            This will permanently delete the agent class record. All attached instances will be cascade deleted from the governance platform.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="border-white/10 bg-transparent text-ink-secondary font-mono text-xs">
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={async () => {
                              try {
                                await api.deleteAgentClass(cls.id);
                                if (onRefresh) onRefresh();
                              } catch (err: any) {
                                alert(`Failed to delete class: ${err.message || 'Unknown error'}`);
                              }
                            }}
                            className="bg-rose-600 text-white hover:bg-rose-500 font-mono text-xs"
                          >
                            Delete Class
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  {cls.status === 'revoked' ? (
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        await api.reviveAgentClass(cls.id);
                        if (onRefresh) onRefresh();
                      }}
                      className="font-mono text-[10px] uppercase tracking-widest text-signal-healthy hover:bg-signal-healthy/10"
                    >
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Reactivate Class
                    </Button>
                  ) : (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          className="font-mono text-[10px] uppercase tracking-widest text-signal-stopped hover:bg-signal-stopped/10"
                        >
                          <Ban className="mr-1 h-3 w-3" />
                          Revoke all instances
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="border-white/10 bg-slate-950 text-white">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="font-mono text-sm uppercase tracking-widest">
                            Revoke all instances of {cls.name}?
                          </AlertDialogTitle>
                          <AlertDialogDescription className="font-sans text-xs text-ink-secondary">
                            Every active instance in this class will be immediately revoked. All pending actions will be blocked by the gateway.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="border-white/10 bg-transparent text-ink-secondary font-mono text-xs">
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={async () => {
                              try {
                                await api.revokeAgentClass(cls.id);
                                if (onRefresh) onRefresh();
                              } catch (err: any) {
                                alert(`Failed to revoke class: ${err.message || 'Unknown error'}`);
                              }
                            }}
                            className="bg-rose-600 text-white hover:bg-rose-500 font-mono text-xs"
                          >
                            Revoke all instances
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      ) : (
        <Panel className="p-12 text-center">
          <Wrench className="mx-auto h-8 w-8 text-ink-secondary/40 mb-3" />
          <h3 className="font-mono text-sm uppercase tracking-widest text-ink-primary font-semibold">
            No Agent Classes Configured
          </h3>
          <p className="mt-1 font-sans text-xs text-ink-secondary max-w-sm mx-auto">
            Agent classes group agents together to define default tool access, rate limits, and spend caps across instances.
          </p>
          <Button
            onClick={() => setShowCreate(true)}
            className="mt-4 border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 font-mono text-xs"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New Class
          </Button>
        </Panel>
      )}

      {/* Edit/Create dialog */}
      <Dialog
        open={!!editClass || showCreate}
        onOpenChange={(open) => {
          if (!open) {
            setEditClass(null);
            setShowCreate(false);
          }
        }}
      >
        <DialogContent className="max-w-2xl border-white/10 bg-slate-950 text-white max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest text-ink-primary">
              {editClass ? `Edit Class: ${editClass.name}` : 'Create New Agent Class'}
            </DialogTitle>
          </DialogHeader>
          <ClassForm
            key={editClass?.id || '__new__'}
            classData={editClass}
            onComplete={() => {
              setEditClass(null);
              setShowCreate(false);
              if (onRefresh) onRefresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClassForm({ classData, onComplete }: { classData: AgentClass | null; onComplete: () => void }) {
  const [tools, setTools] = useState<BankTool[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>(
    classData?.allowedTools || classData?.defaultAllowedTools || []
  );
  const [toolSearch, setToolSearch] = useState('');
  const [toolFilter, setToolFilter] = useState<'all' | 'selected' | 'unselected'>('all');
  const [classId, setClassId] = useState(classData?.id || '');
  const [name, setName] = useState(classData?.name || '');
  const [description, setDescription] = useState(classData?.description || '');
  const caps = (classData as any)?.defaultCaps || (classData as any)?.default_caps || {};
  const initHourly = caps.hourly?.amount_cents != null ? (caps.hourly.amount_cents / 100).toString() : '';
  const initDaily = caps.daily?.amount_cents != null ? (caps.daily.amount_cents / 100).toString() : '';
  const initPerTx = caps.per_transaction?.max_amount_cents != null ? (caps.per_transaction.max_amount_cents / 100).toString() : '';

  const [hourlyCap, setHourlyCap] = useState(initHourly);
  const [dailyCap, setDailyCap] = useState(initDaily);
  const [perTxCap, setPerTxCap] = useState(initPerTx);

  const [constraintsJson, setConstraintsJson] = useState(
    JSON.stringify(classData?.defaultConstraints || {}, null, 2)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getAllTools().then(setTools).catch(() => {});
  }, []);

  const filteredTools = useMemo(() => {
    return tools.filter((t) => {
      const matchesSearch =
        !toolSearch ||
        t.name.toLowerCase().includes(toolSearch.toLowerCase()) ||
        (t.description && t.description.toLowerCase().includes(toolSearch.toLowerCase()));

      const isSelected = selectedTools.includes(t.name);
      const matchesFilter =
        toolFilter === 'all' ||
        (toolFilter === 'selected' && isSelected) ||
        (toolFilter === 'unselected' && !isSelected);

      return matchesSearch && matchesFilter;
    });
  }, [tools, toolSearch, toolFilter, selectedTools]);

  const handleSelectAllFiltered = () => {
    const filteredNames = filteredTools.map((t) => t.name);
    const newSelected = Array.from(new Set([...selectedTools, ...filteredNames]));
    setSelectedTools(newSelected);
  };

  const handleDeselectAllFiltered = () => {
    const filteredNames = new Set(filteredTools.map((t) => t.name));
    setSelectedTools(selectedTools.filter((name) => !filteredNames.has(name)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    let parsedConstraints = {};
    try {
      if (constraintsJson.trim()) {
        parsedConstraints = JSON.parse(constraintsJson);
      }
    } catch (err) {
      setError('Constraints must be valid JSON format.');
      return;
    }

    const id = classId.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name || !id) {
      setError('Please fill in Class ID and Class Name.');
      return;
    }

    const defaultCaps: Record<string, any> = {};
    if (hourlyCap.trim() !== '') {
      defaultCaps.hourly = { amount_cents: Math.max(0, (parseFloat(hourlyCap) || 0) * 100) };
    }
    if (dailyCap.trim() !== '') {
      defaultCaps.daily = { amount_cents: Math.max(0, (parseFloat(dailyCap) || 0) * 100) };
    }
    if (perTxCap.trim() !== '') {
      defaultCaps.per_transaction = { max_amount_cents: Math.max(0, (parseFloat(perTxCap) || 0) * 100) };
    }

    setLoading(true);
    try {
      const payload = {
        id,
        name,
        description,
        default_allowed_tools: selectedTools,
        default_constraints: parsedConstraints,
        default_caps: defaultCaps,
        status: 'active',
      };

      if (classData) {
        await api.updateAgentClass(classData.id, payload as any);
      } else {
        await api.createAgentClass(payload as any);
      }
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Failed to save class');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      {error && (
        <div className="border border-rose-500/30 bg-rose-500/10 p-2.5 rounded font-mono text-xs text-rose-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Class ID</Label>
          <Input
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            disabled={!!classData}
            placeholder="e.g. database_analytics"
            className="mt-1 border-white/10 bg-white/5 font-mono text-xs"
            required
          />
        </div>
        <div>
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Class Display Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Analytics & Reporting Bot"
            className="mt-1 border-white/10 bg-white/5 font-mono text-xs"
            required
          />
        </div>
      </div>

      <div>
        <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Description</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief summary of group responsibilities"
          className="mt-1 border-white/10 bg-white/5 font-mono text-xs"
        />
      </div>

      <div>
        <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary mb-1 block">
          Spend Caps Configuration ($ USD — Optional)
        </Label>
        <div className="grid grid-cols-3 gap-3 border border-white/10 bg-white/[0.02] p-2.5 rounded-lg">
          <div>
            <Label className="font-mono text-[10px] text-ink-secondary/80">Hourly Cap ($)</Label>
            <Input
              type="number"
              value={hourlyCap}
              onChange={(e) => setHourlyCap(e.target.value)}
              placeholder="e.g. 5000"
              className="mt-1 h-8 border-white/10 bg-slate-900/80 font-mono text-xs text-white placeholder:text-ink-secondary/40"
            />
          </div>
          <div>
            <Label className="font-mono text-[10px] text-ink-secondary/80">Daily Cap ($)</Label>
            <Input
              type="number"
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              placeholder="e.g. 50000"
              className="mt-1 h-8 border-white/10 bg-slate-900/80 font-mono text-xs text-white placeholder:text-ink-secondary/40"
            />
          </div>
          <div>
            <Label className="font-mono text-[10px] text-ink-secondary/80">Per-Tx Cap ($)</Label>
            <Input
              type="number"
              value={perTxCap}
              onChange={(e) => setPerTxCap(e.target.value)}
              placeholder="e.g. 1000"
              className="mt-1 h-8 border-white/10 bg-slate-900/80 font-mono text-xs text-white placeholder:text-ink-secondary/40"
            />
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            Allowed Registered MCP Tools ({selectedTools.length} of {tools.length} selected)
          </Label>
          {tools.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="font-mono text-[10px] text-cyan-400 hover:underline cursor-pointer"
              >
                Select {toolSearch || toolFilter !== 'all' ? 'matching' : 'all'}
              </button>
              <span className="text-white/20 text-[10px]">·</span>
              <button
                type="button"
                onClick={handleDeselectAllFiltered}
                className="font-mono text-[10px] text-rose-400 hover:underline cursor-pointer"
              >
                Deselect {toolSearch || toolFilter !== 'all' ? 'matching' : 'all'}
              </button>
            </div>
          )}
        </div>

        {tools.length > 0 ? (
          <div className="space-y-2 border border-white/10 bg-white/[0.02] p-2.5 rounded-lg">
            {/* Search & Filter Bar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-secondary" />
                <Input
                  value={toolSearch}
                  onChange={(e) => setToolSearch(e.target.value)}
                  placeholder="Search tools by name..."
                  className="h-8 border-white/10 bg-slate-900/80 pl-8 pr-7 font-mono text-xs text-white placeholder:text-ink-secondary/50 focus:border-cyan-500/50"
                />
                {toolSearch && (
                  <button
                    type="button"
                    onClick={() => setToolSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-secondary hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="flex rounded border border-white/10 bg-slate-900/80 p-0.5 font-mono text-[10px]">
                <button
                  type="button"
                  onClick={() => setToolFilter('all')}
                  className={cn(
                    'px-2 py-1 rounded transition-colors',
                    toolFilter === 'all' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-ink-secondary hover:text-white'
                  )}
                >
                  All ({tools.length})
                </button>
                <button
                  type="button"
                  onClick={() => setToolFilter('selected')}
                  className={cn(
                    'px-2 py-1 rounded transition-colors',
                    toolFilter === 'selected' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-ink-secondary hover:text-white'
                  )}
                >
                  Selected ({selectedTools.length})
                </button>
                <button
                  type="button"
                  onClick={() => setToolFilter('unselected')}
                  className={cn(
                    'px-2 py-1 rounded transition-colors',
                    toolFilter === 'unselected' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-ink-secondary hover:text-white'
                  )}
                >
                  Unselected ({tools.length - selectedTools.length})
                </button>
              </div>
            </div>

            {/* Tools Grid */}
            {filteredTools.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                {filteredTools.map((t) => {
                  const isChecked = selectedTools.includes(t.name);
                  return (
                    <label
                      key={t.name}
                      className={cn(
                        'flex items-start gap-2 border p-2 rounded cursor-pointer transition-all',
                        isChecked
                          ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200 shadow-[0_0_10px_-3px_rgba(6,182,212,0.2)]'
                          : 'border-white/5 bg-white/[0.02] text-ink-secondary hover:border-white/20 hover:bg-white/5 hover:text-ink-primary'
                      )}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          setSelectedTools((prev) =>
                            checked ? [...prev, t.name] : prev.filter((name) => name !== t.name)
                          );
                        }}
                        className="mt-0.5 border-white/20 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs font-semibold text-white flex items-center justify-between">
                          <span className="truncate">{t.name}</span>
                        </div>
                        {t.description && (
                          <div className="font-mono text-[10px] text-ink-secondary/70 line-clamp-1 mt-0.5">
                            {t.description}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 text-center font-mono text-xs text-ink-secondary">
                No tools matching "{toolSearch}"
              </div>
            )}
          </div>
        ) : (
          <div className="border border-white/5 bg-white/[0.02] p-4 text-center font-mono text-xs text-ink-secondary rounded">
            No MCP tools registered yet. Add a Bank Connection or MCP server first.
          </div>
        )}
      </div>

      {/* Visual Dynamic Tool Constraints Configurator */}
      <VisualConstraintEditor
        selectedTools={selectedTools}
        constraintsJson={constraintsJson}
        setConstraintsJson={setConstraintsJson}
      />

      <div className="flex justify-end gap-2 pt-2">
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
          {classData ? 'Save Changes' : 'Create Class'}
        </Button>
      </div>
    </form>
  );
}

function VisualConstraintEditor({
  selectedTools,
  constraintsJson,
  setConstraintsJson,
}: {
  selectedTools: string[];
  constraintsJson: string;
  setConstraintsJson: (s: string) => void;
}) {
  const [editorMode, setEditorMode] = useState<'visual' | 'json'>('visual');
  const [targetTool, setTargetTool] = useState<string>(selectedTools[0] || 'transfer_money');
  const [maxCalls, setMaxCalls] = useState<string>('60');
  const [windowSec, setWindowSec] = useState<string>('3600');
  const [startTime, setStartTime] = useState<string>('09:00');
  const [endTime, setEndTime] = useState<string>('17:00');
  const [maxAmount, setMaxAmount] = useState<string>('1000');

  useEffect(() => {
    if (selectedTools.length > 0 && !selectedTools.includes(targetTool)) {
      setTargetTool(selectedTools[0]);
    }
  }, [selectedTools]);

  const parsedObj = useMemo(() => {
    try {
      return JSON.parse(constraintsJson) || {};
    } catch {
      return {};
    }
  }, [constraintsJson]);

  const handleAddConstraint = () => {
    if (!targetTool) return;
    const current = { ...parsedObj };

    const toolRule: Record<string, any> = current[targetTool] || {};

    if (maxCalls.trim() && windowSec.trim()) {
      toolRule.rate_limit = {
        max_calls: parseInt(maxCalls) || 60,
        window_seconds: parseInt(windowSec) || 3600,
      };
    }

    if (startTime.trim() && endTime.trim()) {
      toolRule.time_window = {
        start: startTime.trim(),
        end: endTime.trim(),
        tz: 'UTC',
      };
    }

    if (maxAmount.trim()) {
      toolRule.max_amount = parseFloat(maxAmount) || 1000.0;
    }

    current[targetTool] = toolRule;
    setConstraintsJson(JSON.stringify(current, null, 2));
  };

  const handleRemoveToolConstraint = (tName: string) => {
    const current = { ...parsedObj };
    delete current[tName];
    setConstraintsJson(JSON.stringify(current, null, 2));
  };

  return (
    <div className="space-y-2 border border-white/10 bg-white/[0.02] p-3 rounded-lg">
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-cyan-400" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-primary font-semibold">
            Dynamic Operational Constraints (Rate Limits & Time Windows)
          </span>
        </div>
        <div className="flex items-center border border-white/10 bg-slate-900 p-0.5 font-mono text-[10px]">
          <button
            type="button"
            onClick={() => setEditorMode('visual')}
            className={cn(
              'px-2 py-0.5 rounded uppercase transition-colors',
              editorMode === 'visual' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-ink-secondary hover:text-white'
            )}
          >
            Visual Form
          </button>
          <button
            type="button"
            onClick={() => setEditorMode('json')}
            className={cn(
              'px-2 py-0.5 rounded uppercase transition-colors',
              editorMode === 'json' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-ink-secondary hover:text-white'
            )}
          >
            Raw JSON
          </button>
        </div>
      </div>

      {editorMode === 'visual' ? (
        <div className="space-y-3 pt-1">
          {/* Active Configured Constraints Cards */}
          <div className="space-y-1.5">
            {Object.keys(parsedObj).length > 0 ? (
              Object.entries(parsedObj).map(([tName, conf]: [string, any]) => (
                <div key={tName} className="flex items-center justify-between border border-white/10 bg-slate-900/90 p-2 rounded font-mono text-xs">
                  <div>
                    <span className="text-cyan-400 font-bold">{tName}</span>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-secondary mt-0.5">
                      {conf.rate_limit && (
                        <span>Rate Limit: <strong className="text-white">{conf.rate_limit.max_calls} calls</strong> / {conf.rate_limit.window_seconds}s</span>
                      )}
                      {conf.time_window && (
                        <span>Hours: <strong className="text-amber-300">{conf.time_window.start} - {conf.time_window.end} UTC</strong></span>
                      )}
                      {conf.max_amount != null && (
                        <span>Max Amount: <strong className="text-emerald-400">${conf.max_amount}</strong></span>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveToolConstraint(tName)}
                    className="h-6 px-1.5 text-rose-400 hover:bg-rose-500/10"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            ) : (
              <span className="font-mono text-[10px] text-ink-secondary/60 block py-1">
                No tool rate limits or time windows configured yet. Use form below to add.
              </span>
            )}
          </div>

          {/* Add / Update Tool Constraint Form */}
          <div className="border border-white/5 bg-slate-950 p-2.5 rounded space-y-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-cyan-400 font-semibold block">
              Configure Constraint for Scoped Tool
            </span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="font-mono text-[10px] text-ink-secondary">Select Tool</Label>
                <select
                  value={targetTool}
                  onChange={(e) => setTargetTool(e.target.value)}
                  className="mt-1 h-8 w-full border border-white/10 bg-slate-900 px-2 font-mono text-xs text-white rounded"
                >
                  {selectedTools.length > 0 ? (
                    selectedTools.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))
                  ) : (
                    <option value="transfer_money">transfer_money</option>
                  )}
                </select>
              </div>

              <div>
                <Label className="font-mono text-[10px] text-ink-secondary">Max Call Amount ($)</Label>
                <Input
                  type="number"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  placeholder="e.g. 1000"
                  className="mt-1 h-8 border-white/10 bg-slate-900 font-mono text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="font-mono text-[10px] text-ink-secondary">Rate Limit (Max Calls)</Label>
                <Input
                  type="number"
                  value={maxCalls}
                  onChange={(e) => setMaxCalls(e.target.value)}
                  placeholder="e.g. 60"
                  className="mt-1 h-8 border-white/10 bg-slate-900 font-mono text-xs text-white"
                />
              </div>
              <div>
                <Label className="font-mono text-[10px] text-ink-secondary">Window (Seconds)</Label>
                <Input
                  type="number"
                  value={windowSec}
                  onChange={(e) => setWindowSec(e.target.value)}
                  placeholder="e.g. 3600"
                  className="mt-1 h-8 border-white/10 bg-slate-900 font-mono text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="font-mono text-[10px] text-ink-secondary">Business Hours Start (UTC)</Label>
                <Input
                  type="text"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  placeholder="09:00"
                  className="mt-1 h-8 border-white/10 bg-slate-900 font-mono text-xs text-white"
                />
              </div>
              <div>
                <Label className="font-mono text-[10px] text-ink-secondary">Business Hours End (UTC)</Label>
                <Input
                  type="text"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  placeholder="17:00"
                  className="mt-1 h-8 border-white/10 bg-slate-900 font-mono text-xs text-white"
                />
              </div>
            </div>

            <Button
              type="button"
              onClick={handleAddConstraint}
              className="mt-1 w-full h-7 border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 font-mono text-xs"
            >
              <Plus className="h-3 w-3 mr-1" /> Add / Update Tool Constraint
            </Button>
          </div>
        </div>
      ) : (
        <textarea
          value={constraintsJson}
          onChange={(e) => setConstraintsJson(e.target.value)}
          placeholder={`{\n  "transfer_money": {\n    "rate_limit": {"max_calls": 60, "window_seconds": 3600},\n    "time_window": {"start": "09:00", "end": "17:00", "tz": "UTC"}\n  }\n}`}
          className="mt-1 h-36 w-full border border-white/10 bg-slate-900 p-2 font-mono text-[11px] leading-relaxed rounded text-white focus:outline-none focus:border-cyan-500"
        />
      )}
    </div>
  );
}
