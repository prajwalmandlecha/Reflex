'use client';

import { useState, useEffect } from 'react';
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
import { Plus, Ban, Wrench, DollarSign, Clock, Settings2 } from 'lucide-react';

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
                          await api.revokeAgentClass(cls.id);
                          if (onRefresh) onRefresh();
                        }}
                        className="bg-rose-600 text-white hover:bg-rose-500 font-mono text-xs"
                      >
                        Revoke all instances
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </Panel>
          );
        })}
      </div>

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
  const [classId, setClassId] = useState(classData?.id || '');
  const [name, setName] = useState(classData?.name || '');
  const [description, setDescription] = useState(classData?.description || '');
  const [capAmount, setCapAmount] = useState('5000');
  const [constraintsJson, setConstraintsJson] = useState(
    JSON.stringify(classData?.defaultConstraints || {}, null, 2)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getAllTools().then(setTools).catch(() => {});
  }, []);

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

    setLoading(true);
    try {
      const payload = {
        id,
        name,
        description,
        default_allowed_tools: selectedTools,
        default_constraints: parsedConstraints,
        default_caps: { hourly: { amount_cents: (parseFloat(capAmount) || 0) * 100 } },
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
        <div className="flex items-center justify-between mb-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            Allowed Registered MCP Tools ({selectedTools.length} selected)
          </Label>
          {tools.length === 0 && (
            <span className="font-mono text-[10px] text-amber-400">No tools registered in database</span>
          )}
        </div>

        {tools.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-white/10 bg-white/[0.02] p-2 rounded">
            {tools.map((t) => (
              <label
                key={t.name}
                className={cn(
                  'flex items-center gap-2 border p-1.5 rounded cursor-pointer transition-colors',
                  selectedTools.includes(t.name)
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                    : 'border-white/5 bg-white/5 text-ink-secondary hover:text-ink-primary'
                )}
              >
                <Checkbox
                  checked={selectedTools.includes(t.name)}
                  onCheckedChange={(checked) => {
                    setSelectedTools((prev) =>
                      checked ? [...prev, t.name] : prev.filter((name) => name !== t.name)
                    );
                  }}
                />
                <span className="font-mono text-xs">{t.name}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="border border-white/5 bg-white/[0.02] p-4 text-center font-mono text-xs text-ink-secondary rounded">
            No MCP tools registered yet. Add a Bank Connection or MCP server first.
          </div>
        )}
      </div>

      <div>
        <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
          Dynamic Tool Constraints (JSON format)
        </Label>
        <textarea
          value={constraintsJson}
          onChange={(e) => setConstraintsJson(e.target.value)}
          placeholder={`{\n  "db_query": {\n    "numeric_bounds": {"max_rows": {"max": 500}},\n    "regex_deny": {"query": "(?i)(DROP|DELETE)"}\n  }\n}`}
          className="mt-1 h-32 w-full border border-white/10 bg-white/5 p-2 font-mono text-[11px] leading-relaxed rounded text-white focus:outline-none focus:border-cyan-500"
        />
      </div>

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
