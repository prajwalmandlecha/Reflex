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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

import type { AgentClass, AgentInstance, BankTool } from '@/lib/types';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Plus, Ban, Wrench, DollarSign, Clock, Settings2, Search, X, CheckCircle2, Trash2, ChevronDown, Eye, Layers } from 'lucide-react';

export function AgentClassesView({
  classes,
  instances,
  onRefresh,
}: {
  classes: AgentClass[];
  instances: AgentInstance[];
  onRefresh?: () => void;
}) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('classes:create');
  const canUpdate = hasPermission('classes:update');

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
            Define default permissions and constraints for groups of agents.
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => setShowCreate(true)}
            className="border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 font-mono text-xs"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New class
          </Button>
        )}
      </div>

      {classes.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {classes.map((cls) => {
            const clsInstances = instances.filter((i) => i.classId === cls.id);
            const activeCount = clsInstances.filter((i) => i.status === 'active').length;
            const unreachable = cls.unreachableTools || [];
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
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                        {activeCount}/{cls.instanceCount || clsInstances.length} active
                      </span>
                      {unreachable.length > 0 && (
                        <span className="inline-flex items-center rounded-full border border-signal-caution/20 bg-signal-caution/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-signal-caution">
                          {unreachable.length} tool{unreachable.length !== 1 ? 's' : ''} unreachable
                        </span>
                      )}
                    </div>
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
                      {(cls.allowedTools || cls.defaultAllowedTools || []).map((t) => {
                        const isDown = unreachable.includes(t);
                        return (
                          <span
                            key={t}
                            title={isDown ? 'Currently unreachable (bank connection down)' : undefined}
                            className={isDown
                              ? 'border border-signal-caution/30 bg-signal-caution/10 px-1.5 py-0.5 font-mono text-[10px] text-signal-caution rounded'
                              : 'border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-400 rounded'
                            }
                          >
                            {t}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                <div className="bg-white/[0.02] p-3">
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="h-3 w-3 text-ink-secondary" />
                      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                        Param Caps
                      </span>
                    </div>
                    <div className="mt-1.5 font-mono text-xs text-ink-primary tabular font-medium">
                      {Object.values(cls.defaultConstraints || {}).some((c: any) => c?.params && Object.keys(c.params).length > 0)
                        ? `${Object.values(cls.defaultConstraints || {}).reduce((n: number, c: any) => n + Object.keys(c?.params || {}).length, 0)} configured`
                        : 'No param caps'}
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
            Agent classes group agents together to define default tool access, rate limits, and parameter-level spend caps across instances.
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

function ClassForm({
  classData,
  onComplete,
}: {
  classData: AgentClass | null;
  onComplete: () => void;
}) {
  const { hasPermission } = useAuth();
  const canEdit = classData ? hasPermission('classes:update') : hasPermission('classes:create');
  const [tools, setTools] = useState<BankTool[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>(
    classData?.allowedTools || classData?.defaultAllowedTools || []
  );
  const [toolSearch, setToolSearch] = useState('');
  const [toolFilter, setToolFilter] = useState<'all' | 'selected' | 'unselected'>('all');
  const [name, setName] = useState(classData?.name || '');
  const [description, setDescription] = useState(classData?.description || '');

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

    // id is derived from the display name (slugified) unless editing an existing class.
    const id = classData?.id || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!name || !id) {
      setError('Please fill in Class Name.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        id,
        name,
        description,
        default_allowed_tools: selectedTools,
        default_constraints: parsedConstraints,
        default_caps: {},
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

      <div>
        <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Class Display Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Analytics & Reporting Bot"
          className="mt-1 border-white/10 bg-white/5 font-mono text-xs"
          required
        />
        {!classData && (
          <p className="mt-1 font-mono text-[10px] text-ink-secondary">
            ID: <span className="text-cyan-400">{name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '—'}</span>
          </p>
        )}
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
        tools={tools}
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
        {!canEdit ? (
          <div className="flex items-center gap-1.5 px-3 py-1 font-mono text-xs text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded">
            <Eye className="h-3.5 w-3.5" />
            Read-Only (Auditor View)
          </div>
        ) : (
          <Button
            type="submit"
            disabled={loading}
            className="bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-mono text-xs font-semibold px-5 h-8"
          >
            {classData ? 'Save Changes' : 'Create Class'}
          </Button>
        )}
      </div>
    </form>
  );
}

function VisualConstraintEditor({
  selectedTools,
  tools,
  constraintsJson,
  setConstraintsJson,
}: {
  selectedTools: string[];
  tools: BankTool[];
  constraintsJson: string;
  setConstraintsJson: (s: string) => void;
}) {
  const [editorMode, setEditorMode] = useState<'visual' | 'json'>('visual');
  const [targetTool, setTargetTool] = useState<string>(selectedTools[0] || '');
  // All fields start EMPTY so nothing is added unless the user explicitly fills
  // it in. Previously these were pre-filled (60/3600/09:00/17:00), which meant
  // clicking "Add" silently injected a rate limit AND a time window the user
  // never asked for.
  const [maxCalls, setMaxCalls] = useState<string>('');
  const [windowSec, setWindowSec] = useState<string>('');
  const [rlScope, setRlScope] = useState<'instance' | 'class'>('instance');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [paramName, setParamName] = useState<string>('');
  const [paramMax, setParamMax] = useState<string>('');
  const [accWindow, setAccWindow] = useState<'daily' | 'hourly' | 'monthly'>('daily');
  const [accScope, setAccScope] = useState<'instance' | 'class'>('instance');
  const [accLimit, setAccLimit] = useState<string>('');
  const [capError, setCapError] = useState<string>('');
  const [constraintsOpen, setConstraintsOpen] = useState(false);

  useEffect(() => {
    if (selectedTools.length > 0 && !selectedTools.includes(targetTool)) {
      setTargetTool(selectedTools[0]);
    }
  }, [selectedTools]);

  const targetToolMeta = useMemo(
    () => tools.find((t) => t.name === targetTool),
    [tools, targetTool]
  );
  const numericParams = useMemo(() => {
    const schema = (targetToolMeta?.input_schema || {}) as Record<string, any>;
    const props = (schema.properties || {}) as Record<string, any>;
    return Object.entries(props)
      .filter(([, def]) => {
        const type = (def && (def as any).type) || '';
        return type === 'number' || type === 'integer';
      })
      .map(([name]) => name);
  }, [targetToolMeta]);

  const requiredParams = useMemo(() => {
    const schema = (targetToolMeta?.input_schema || {}) as Record<string, any>;
    const req = new Set<string>(schema.required || []);
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      for (const branch of (schema[key] || []) as any[]) {
        if (branch && Array.isArray(branch.required)) {
          branch.required.forEach((f: string) => req.add(f));
        }
      }
    }
    return req;
  }, [targetToolMeta]);

  useEffect(() => {
    if (paramName && !numericParams.includes(paramName)) {
      setParamName('');
    }
  }, [numericParams]);

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
      const maxCallsNum = parseInt(maxCalls) || 60;
      const windowSecNum = parseInt(windowSec) || 3600;
      if (rlScope === 'instance') {
        toolRule.rate_limit = {
          max_calls: maxCallsNum,
          window_seconds: windowSecNum,
        };
      } else {
        // Class-scoped rate limit: shared across every agent in the class via
        // shared_rate_limits with scope "class". Fleet scope is managed globally
        // in Fleet Caps, so it is intentionally not offered here.
        const shared: any[] = Array.isArray(toolRule.shared_rate_limits)
          ? toolRule.shared_rate_limits.filter(
              (srl: any) => !(srl.scope === 'class' && srl.max_calls === maxCallsNum && srl.window_seconds === windowSecNum)
            )
          : [];
        shared.push({ scope: 'class', max_calls: maxCallsNum, window_seconds: windowSecNum });
        toolRule.shared_rate_limits = shared;
      }
    }

    if (startTime.trim() && endTime.trim()) {
      toolRule.time_window = {
        start: startTime.trim(),
        end: endTime.trim(),
        tz: 'UTC',
      };
    }

    if (paramName.trim() && paramMax.trim() !== '') {
      const params = { ...(toolRule.params || {}) };
      const prule = { ...(params[paramName.trim()] || {}) };
      prule.max = Math.max(0, parseFloat(paramMax) || 0);
      params[paramName.trim()] = prule;
      toolRule.params = params;
    }

    current[targetTool] = toolRule;
    setConstraintsJson(JSON.stringify(current, null, 2));
  };

  const handleAddAccCap = () => {
    if (!targetTool || !paramName || !accLimit.trim()) return;
    // A param named *_cents is already in cents (no ×100); major-unit params
    // are dollars and must be converted to cents. This must match the gateway's
    // SharedCapEntries / ParamCounterEntries convention exactly.
    const isCentsParam = paramName.endsWith('_cents');
    const cents = Math.max(0, Math.round((parseFloat(accLimit) || 0) * (isCentsParam ? 1 : 100)));
    if (cents <= 0) return;

    const current = { ...parsedObj };
    const toolRule: Record<string, any> = current[targetTool] || {};
    const sharedCaps: any[] = Array.isArray(toolRule.shared_caps) ? toolRule.shared_caps : [];

    if (accScope === 'instance') {
      const classCap = sharedCaps.find((sc) => sc.scope === 'class' && sc.param === paramName && sc.window === accWindow);
      if (classCap && cents > classCap.limit_cents) {
        setCapError(`Instance cap cannot exceed Class-level cap ($${(classCap.limit_cents / 100).toLocaleString()}) for ${paramName} (${accWindow}).`);
        return;
      }
    }

    setCapError('');

    if (accScope === 'instance') {
      const params = { ...(toolRule.params || {}) };
      const prule = { ...(params[paramName] || {}) };
      if (accWindow === 'daily') prule.daily_cents = cents;
      else if (accWindow === 'hourly') prule.hourly_cents = cents;
      else if (accWindow === 'monthly') prule.monthly_cents = cents;
      params[paramName] = prule;
      toolRule.params = params;
    } else {
      let existing: any[] = Array.isArray(toolRule.shared_caps) ? [...toolRule.shared_caps] : [];
      existing = existing.filter(
        (c: any) => !(c.scope === accScope && c.param === paramName && c.window === accWindow)
      );
      existing.push({
        scope: accScope,
        param: paramName,
        window: accWindow,
        limit_cents: cents,
      });
      toolRule.shared_caps = existing;
    }

    current[targetTool] = toolRule;
    setConstraintsJson(JSON.stringify(current, null, 2));
    setAccLimit('');
  };

  const handleRemoveAccCap = (win: string, scope: string) => {
    if (!targetTool || !paramName) return;
    const current = { ...parsedObj };
    const toolRule: Record<string, any> = current[targetTool] || {};

    if (scope === 'instance') {
      if (toolRule.params && toolRule.params[paramName]) {
        const prule = { ...toolRule.params[paramName] };
        if (win === 'daily') delete prule.daily_cents;
        if (win === 'hourly') delete prule.hourly_cents;
        if (win === 'monthly') delete prule.monthly_cents;
        if (Object.keys(prule).length > 0) {
          toolRule.params[paramName] = prule;
        } else {
          delete toolRule.params[paramName];
          if (Object.keys(toolRule.params).length === 0) delete toolRule.params;
        }
      }
    } else {
      if (Array.isArray(toolRule.shared_caps)) {
        toolRule.shared_caps = toolRule.shared_caps.filter(
          (c: any) => !(c.scope === scope && c.param === paramName && c.window === win)
        );
        if (toolRule.shared_caps.length === 0) delete toolRule.shared_caps;
      }
    }

    current[targetTool] = toolRule;
    setConstraintsJson(JSON.stringify(current, null, 2));
  };

  const handleRemoveToolConstraint = (tName: string) => {
    const current = { ...parsedObj };
    delete current[tName];
    setConstraintsJson(JSON.stringify(current, null, 2));
  };

  const handleEditToolConstraint = (tName: string) => {
    const conf = parsedObj[tName] || {};
    setTargetTool(tName);
    const classRl = (conf.shared_rate_limits || []).find((srl: any) => srl.scope === 'class');
    if (classRl) {
      setRlScope('class');
      setMaxCalls(classRl.max_calls?.toString() ?? '');
      setWindowSec(classRl.window_seconds?.toString() ?? '');
    } else {
      setRlScope('instance');
      setMaxCalls(conf.rate_limit?.max_calls?.toString() ?? '');
      setWindowSec(conf.rate_limit?.window_seconds?.toString() ?? '');
    }
    const firstParam = Object.keys(conf.params || {})[0] || '';
    setParamName(firstParam);
    const prule = (conf.params || {})[firstParam] || {};
    setParamMax(prule.max != null ? prule.max.toString() : '');
    setEditorMode('visual');
  };

  return (
    <Collapsible
      open={constraintsOpen}
      onOpenChange={setConstraintsOpen}
      className="space-y-2 border border-white/10 bg-white/[0.02] p-3 rounded-lg"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left cursor-pointer group hover:opacity-90 select-none pr-3">
          <ChevronDown
            className={cn(
              'h-4 w-4 text-ink-secondary transition-transform duration-200 shrink-0 group-hover:text-cyan-400',
              constraintsOpen && 'rotate-180 text-cyan-400'
            )}
          />
          <Clock className="h-4 w-4 text-cyan-400 shrink-0" />
          <span className="font-mono text-xs uppercase tracking-widest text-ink-primary font-semibold">
            Dynamic Operational Constraints (Rate Limits & Parameter Spend Caps)
          </span>
        </CollapsibleTrigger>

        <div className="flex items-center gap-1 border border-white/10 bg-slate-900/90 p-1 rounded-md font-mono text-[10px] shrink-0 shadow-inner">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditorMode('visual');
            }}
            className={cn(
              'px-2.5 py-1 rounded text-[10px] font-mono font-semibold uppercase whitespace-nowrap transition-all duration-150 cursor-pointer',
              editorMode === 'visual'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                : 'text-ink-secondary hover:text-white hover:bg-white/5'
            )}
          >
            Visual Form
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditorMode('json');
            }}
            className={cn(
              'px-2.5 py-1 rounded text-[10px] font-mono font-semibold uppercase whitespace-nowrap transition-all duration-150 cursor-pointer',
              editorMode === 'json'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                : 'text-ink-secondary hover:text-white hover:bg-white/5'
            )}
          >
            Raw JSON
          </button>
        </div>
      </div>

      <CollapsibleContent>
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
                      {Array.isArray(conf.shared_rate_limits) && conf.shared_rate_limits.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Layers className="h-3 w-3 text-violet-400" />
                          <strong className="text-violet-300">
                            {(conf.shared_rate_limits as any[])
                              .filter((srl: any) => srl.scope === 'class')
                              .map((srl: any) => `Class: ≤ ${srl.max_calls} calls / ${srl.window_seconds}s`)
                              .join('; ')}
                          </strong>
                        </span>
                      )}
                      {conf.params && Object.keys(conf.params).length > 0 && (
                        <span>
                          Param Caps:{' '}
                          <strong className="text-cyan-300">
                            {Object.entries(conf.params)
                              .map(([p, r]) => {
                                const rule = (r || {}) as Record<string, any>;
                                const bits: string[] = [];
                                if (rule.max != null) bits.push(`max $${rule.max}`);
                                if (rule.daily_cents != null) bits.push(`daily $${(rule.daily_cents / 100).toLocaleString()}`);
                                if (rule.hourly_cents != null) bits.push(`hourly $${(rule.hourly_cents / 100).toLocaleString()}`);
                                if (rule.monthly_cents != null) bits.push(`monthly $${(rule.monthly_cents / 100).toLocaleString()}`);
                                return `${p} (${bits.join(', ')})`;
                              })
                              .join('; ')}
                          </strong>
                        </span>
                      )}
                      {Array.isArray(conf.shared_caps) && conf.shared_caps.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Layers className="h-3 w-3 text-violet-400" />
                          <strong className="text-violet-300">
                            {(conf.shared_caps as any[]).map((sc: any) => {
                              const label = sc.scope === 'fleet' ? 'Fleet' : 'Class';
                              return `${label}: ${sc.param} ≤ $${((sc.limit_cents || 0) / 100).toLocaleString()}/${sc.window}`;
                            }).join('; ')}
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEditToolConstraint(tName)}
                      className="h-6 px-1.5 text-cyan-400 hover:bg-cyan-500/10"
                      title="Edit this constraint"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveToolConstraint(tName)}
                      className="h-6 px-1.5 text-rose-400 hover:bg-rose-500/10"
                      title="Remove this constraint"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <span className="font-mono text-[10px] text-ink-secondary/60 block py-1">
                No tool rate limits or parameter caps configured yet. Use form below to add.
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
                    <option value="">Select allowed tools above first</option>
                  )}
                </select>
              </div>

              <div>
                <Label className="font-mono text-[10px] text-ink-secondary">Parameter (from tool schema)</Label>
                <select
                  value={paramName}
                  onChange={(e) => setParamName(e.target.value)}
                  disabled={numericParams.length === 0}
                  className="mt-1 h-8 w-full border border-white/10 bg-slate-900 px-2 font-mono text-xs text-white rounded disabled:opacity-50"
                >
                  <option value="">
                    {!targetToolMeta
                      ? 'Tool not registered — connect its MCP server'
                      : numericParams.length === 0
                        ? 'No numeric params in schema'
                        : 'Select a parameter to cap'}
                  </option>
                  {numericParams.map((p) => (
                    <option key={p} value={p}>
                      {p}{requiredParams.has(p) ? ' (required)' : ' (optional)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Per-Call Max Ceiling */}
            <div>
              <Label className="font-mono text-[10px] text-ink-secondary">
                {paramName ? `Per-Call Max Ceiling for "${paramName}" ($)` : 'Per-Call Max Ceiling ($) — select param above'}
              </Label>
              <Input
                type="number"
                value={paramMax}
                onChange={(e) => setParamMax(e.target.value)}
                placeholder="e.g. 1200"
                disabled={!paramName}
                className="mt-1 h-8 border-white/10 bg-slate-900 font-mono text-xs text-white disabled:opacity-40"
              />
            </div>

            {/* Time-Window Accumulation Caps Section (Dynamic Window + Scope + Limit Row) */}
            <div className="border border-white/5 bg-slate-900/60 p-2.5 rounded space-y-2">
              <span className="font-mono text-[10px] text-ink-secondary uppercase tracking-widest font-semibold block">
                {paramName ? `Time-Window Accumulation Caps for "${paramName}"` : 'Time-Window Accumulation Caps — select param above'}
              </span>

              {/* Active Accumulation Caps Badges for current tool & param */}
              {(() => {
                if (!targetTool || !paramName) return null;
                const toolConf = parsedObj[targetTool] || {};
                const prule = (toolConf.params || {})[paramName] || {};
                const sharedCaps = (toolConf.shared_caps || []).filter((sc: any) => sc.param === paramName);

                const activeItems: { window: string; scope: string; limitCents: number; key: string }[] = [];
                if (prule.daily_cents != null) activeItems.push({ window: 'daily', scope: 'instance', limitCents: prule.daily_cents, key: 'p-daily' });
                if (prule.hourly_cents != null) activeItems.push({ window: 'hourly', scope: 'instance', limitCents: prule.hourly_cents, key: 'p-hourly' });
                if (prule.monthly_cents != null) activeItems.push({ window: 'monthly', scope: 'instance', limitCents: prule.monthly_cents, key: 'p-monthly' });

                sharedCaps.forEach((sc: any, idx: number) => {
                  activeItems.push({ window: sc.window, scope: sc.scope, limitCents: sc.limit_cents, key: `s-${idx}` });
                });

                if (activeItems.length === 0) return null;

                return (
                  <div className="flex flex-wrap gap-1.5 py-1 border-b border-white/5 pb-2">
                    {activeItems.map((item) => {
                      const scopeLabel = item.scope === 'fleet' ? '🌐 Fleet' : item.scope === 'class' ? '📦 Class' : '🤖 Instance';
                      return (
                        <div key={item.key} className="flex items-center gap-1.5 border border-white/10 bg-slate-950 px-2 py-1 rounded font-mono text-[11px]">
                          <span className="text-white font-semibold">{scopeLabel}</span>
                          <span className="text-amber-300 font-semibold uppercase">{item.window}:</span>
                          <span className="text-cyan-300 font-bold">${(item.limitCents / 100).toLocaleString()}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveAccCap(item.window, item.scope)}
                            className="text-rose-400 hover:text-rose-300 cursor-pointer ml-0.5"
                            title="Remove this cap"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Single Dynamic Input Row: Window + Scope + Amount + Add Button */}
              <div className="grid grid-cols-4 gap-2 items-end">
                <div>
                  <Label className="font-mono text-[10px] text-ink-secondary">Window</Label>
                  <select
                    value={accWindow}
                    onChange={(e) => setAccWindow(e.target.value as any)}
                    disabled={!paramName}
                    className="mt-1 h-8 w-full border border-white/10 bg-slate-900 px-2 font-mono text-xs text-white rounded disabled:opacity-40"
                  >
                    <option value="daily">Daily</option>
                    <option value="hourly">Hourly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                <div>
                  <Label className="font-mono text-[10px] text-ink-secondary">Scope</Label>
                  <select
                    value={accScope}
                    onChange={(e) => setAccScope(e.target.value as any)}
                    disabled={!paramName}
                    className="mt-1 h-8 w-full border border-white/10 bg-slate-900 px-2 font-mono text-xs text-white rounded disabled:opacity-40"
                  >
                    <option value="instance">Per Agent Instance</option>
                    <option value="class">Across Agent Class</option>
                  </select>
                </div>

                <div>
                  <Label className="font-mono text-[10px] text-ink-secondary">Cap Limit ($)</Label>
                  <Input
                    type="number"
                    value={accLimit}
                    onChange={(e) => setAccLimit(e.target.value)}
                    placeholder="e.g. 5000"
                    disabled={!paramName}
                    className="mt-1 h-8 border-white/10 bg-slate-900 font-mono text-xs text-white disabled:opacity-40"
                  />
                </div>

                <div>
                  <Button
                    type="button"
                    onClick={handleAddAccCap}
                    disabled={!paramName || !accLimit.trim()}
                    className="h-8 w-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 font-mono text-xs disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add Cap
                  </Button>
                </div>
              </div>

              {capError && (
                <div className="font-mono text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2 rounded">
                  {capError}
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="font-mono text-[10px] text-ink-secondary">Rate Limit Scope</Label>
                <select
                  value={rlScope}
                  onChange={(e) => setRlScope(e.target.value as any)}
                  className="mt-1 h-8 w-full border border-white/10 bg-slate-900 px-2 font-mono text-xs text-white rounded"
                >
                  <option value="instance">Per Agent Instance</option>
                  <option value="class">Across Agent Class</option>
                </select>
              </div>
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
          placeholder={`{\n  "transfer_money": {\n    "params": {\n      "amount_cents": {"max": 120000, "daily_cents": 500000, "hourly_cents": 100000}\n    },\n    "rate_limit": {"max_calls": 60, "window_seconds": 3600}\n  }\n}`}
          className="mt-1 h-36 w-full border border-white/10 bg-slate-900 p-2 font-mono text-[11px] leading-relaxed rounded text-white focus:outline-none focus:border-cyan-500"
        />
      )}
      </CollapsibleContent>
    </Collapsible>
  );
}
