'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Panel } from '@/components/gov/panel';
import { StatusBadge } from '@/components/gov/status-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/format';
import type { AgentClass, AgentInstance } from '@/lib/types';
import { Plus, Ban, Wrench, DollarSign, Clock } from 'lucide-react';

export function AgentClassesView({
  classes,
  instances,
}: {
  classes: AgentClass[];
  instances: AgentInstance[];
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
          className="border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
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
                      className="font-mono text-sm text-ink-primary hover:text-accent"
                    >
                      {cls.name}
                    </button>
                    <p className="mt-0.5 font-sans text-xs text-ink-secondary">
                      {cls.description}
                    </p>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                    {activeCount}/{cls.instanceCount} active
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-px bg-white/5">
                <div className="bg-white/[0.02] p-3">
                  <div className="flex items-center gap-1.5">
                    <Wrench className="h-3 w-3 text-ink-secondary" />
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                      Tools
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {cls.allowedTools.map((t) => (
                      <span
                        key={t}
                        className="border border-border bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-ink-primary"
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
                      Default Cap
                    </span>
                  </div>
                  <div className="mt-1.5 font-mono text-xs text-ink-primary tabular">
                    {cls.defaultCap.amount > 0
                      ? `${formatCurrency(cls.defaultCap.amount)} / ${cls.defaultCap.window}`
                      : 'No spend cap'}
                  </div>
                </div>
              </div>

              <div className="border-t border-white/5 p-3">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 text-ink-secondary" />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                    Constraints
                  </span>
                </div>
                <div className="mt-1.5 space-y-0.5">
                  {Object.entries(cls.defaultConstraints).map(([k, v]) => (
                    <div key={k} className="flex justify-between font-mono text-[10px]">
                      <span className="text-ink-secondary">{k}</span>
                      <span className="text-ink-primary">
                        {Array.isArray(v) ? v.join(', ') : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-white/5 p-3">
                <Button
                  variant="ghost"
                  onClick={() => setEditClass(cls)}
                  className="font-mono text-[10px] uppercase tracking-widest text-accent hover:bg-accent/10"
                >
                  Edit class
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
                  <AlertDialogContent className="border-border bg-surface">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="font-mono text-sm uppercase tracking-widest">
                        Revoke all {cls.instanceCount} instances of {cls.name}?
                      </AlertDialogTitle>
                      <AlertDialogDescription className="font-sans text-sm text-ink-secondary">
                        Every active instance in this class will be immediately revoked. All pending
                        actions will be denied until instances are reactivated.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="border-border bg-transparent text-ink-secondary">
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction className="bg-signal-stopped text-white hover:bg-signal-stopped/90">
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
        <DialogContent className="max-w-2xl border-border bg-surface">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest">
              {editClass ? `Edit ${editClass.name}` : 'Create Agent Class'}
            </DialogTitle>
          </DialogHeader>
          <ClassForm classData={editClass} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClassForm({ classData }: { classData: AgentClass | null }) {
  const allTools = [
    'wire_transfer', 'ach_transfer', 'sepa_transfer', 'balance_check',
    'fx_quote', 'sweep_account', 'sanctions_check', 'kyc_lookup',
    'risk_score', 'alert_disposition', 'market_order', 'limit_order',
    'position_check', 'statement_fetch', 'break_report',
  ];
  const [selectedTools, setSelectedTools] = useState<string[]>(
    classData?.allowedTools ?? []
  );
  const [name, setName] = useState(classData?.name ?? '');
  const [capAmount, setCapAmount] = useState(
    classData?.defaultCap.amount.toString() ?? '0'
  );
  const [capWindow, setCapWindow] = useState<'day' | 'month'>(
    classData?.defaultCap.window ?? 'day'
  );

  return (
    <div className="space-y-4">
      <div>
        <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
          Class Name
        </Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Treasury Operations"
          className="mt-1 border-border bg-white/5 font-mono text-sm"
        />
      </div>

      <div>
        <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
          Allowed Tools
        </Label>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {allTools.map((tool) => (
            <label
              key={tool}
              className="flex items-center gap-2 border border-border bg-white/5 px-2 py-1.5"
            >
              <Checkbox
                checked={selectedTools.includes(tool)}
                onCheckedChange={(checked) => {
                  setSelectedTools((prev) =>
                    checked ? [...prev, tool] : prev.filter((t) => t !== tool)
                  );
                }}
              />
              <span className="font-mono text-[11px] text-ink-primary">{tool}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            Default Spend Cap ($)
          </Label>
          <Input
            type="number"
            value={capAmount}
            onChange={(e) => setCapAmount(e.target.value)}
            className="mt-1 border-border bg-white/5 font-mono text-sm tabular"
          />
        </div>
        <div>
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            Cap Window
          </Label>
          <Select value={capWindow} onValueChange={(v) => setCapWindow(v as 'day' | 'month')}>
            <SelectTrigger className="mt-1 border-border bg-white/5 font-mono text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-border bg-white/5">
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="month">Month</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="outline"
          className="border-border text-ink-secondary"
        >
          Cancel
        </Button>
        <Button className="bg-accent text-white hover:bg-accent/90">
          {classData ? 'Save changes' : 'Create class'}
        </Button>
      </div>
    </div>
  );
}
