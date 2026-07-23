'use client';

import { cn } from '@/lib/utils';
import { Panel, StatTile } from '@/components/gov/panel';
import { StatusBadge } from '@/components/gov/status-badge';
import { EmergencyStopControl } from '@/components/gov/emergency-stop';
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
import { formatDateTime, formatRelative } from '@/lib/format';
import type { AgentInstance, AgentClass, StopEvent } from '@/lib/types';
import { Octagon, Ban, Play, History } from 'lucide-react';

export function EmergencyStopView({
  instances,
  classes,
  stopEvents,
  operator,
  onStopInstance,
  onStopClass,
  onStopFleet,
  onResumeInstance,
}: {
  instances: AgentInstance[];
  classes: AgentClass[];
  stopEvents: StopEvent[];
  operator: string;
  onStopInstance: (id: string) => void;
  onStopClass: (classId: string) => void;
  onStopFleet: () => void;
  onResumeInstance: (id: string) => void;
}) {
  const activeCount = instances.filter((i) => i.status === 'active').length;
  const killedCount = instances.filter((i) => i.status === 'killed').length;
  const revokedCount = instances.filter((i) => i.status === 'revoked').length;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Fleet-wide stop */}
      <Panel
        title="Fleet-Wide Emergency Stop"
        className="border-signal-stopped/30"
      >
        <div className="flex items-center justify-between p-6">
          <div>
            <div className="flex items-center gap-2">
              <Octagon className="h-5 w-5 text-signal-stopped" />
              <span className="font-mono text-sm uppercase tracking-widest text-ink-primary">
                Stop Entire Fleet
              </span>
            </div>
            <p className="mt-1 max-w-md font-sans text-xs text-ink-secondary">
              Immediately kills all {activeCount} active agents across every class. All pending
              actions will be denied. Requires press-and-hold + confirm — no accidental triggers.
            </p>
          </div>
          <EmergencyStopControl onConfirm={onStopFleet} />
        </div>
      </Panel>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Active" value={activeCount} accent="healthy" />
        <StatTile label="Revoked" value={revokedCount} accent="caution" />
        <StatTile label="Killed" value={killedCount} accent="stopped" />
      </div>

      {/* Per-class stop */}
      <Panel title="Per-Class Stop">
        <div className="grid grid-cols-1 gap-px bg-white/5 lg:grid-cols-2">
          {classes.map((cls) => {
            const clsInstances = instances.filter((i) => i.classId === cls.id);
            const clsActive = clsInstances.filter((i) => i.status === 'active').length;
            const clsKilled = clsInstances.filter((i) => i.status === 'killed').length;
            return (
              <div key={cls.id} className="bg-white/[0.02] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-sm text-ink-primary">{cls.name}</span>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                      {clsActive} active · {clsKilled} killed
                    </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={clsActive === 0}
                        className="border-signal-stopped/30 text-signal-stopped hover:bg-signal-stopped/10 disabled:border-border disabled:text-ink-secondary/40"
                      >
                        <Ban className="mr-1.5 h-4 w-4" />
                        Stop all
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="border-border bg-surface">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="font-mono text-sm uppercase tracking-widest">
                          Stop all {cls.name} instances?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="font-sans text-sm text-ink-secondary">
                          This will kill {clsActive} active instance(s). All pending actions from this
                          class will be denied until instances are resumed.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="border-border bg-transparent text-ink-secondary">
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-signal-stopped text-white hover:bg-signal-stopped/90"
                          onClick={() => onStopClass(cls.id)}
                        >
                          Stop all instances
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* Per-instance stop/resume */}
      <Panel title="Per-Instance Controls">
        <div className="overflow-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Agent ID', 'Class', 'Status', 'Action'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-widest text-ink-secondary"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {instances.map((inst) => {
                const cls = classes.find((c) => c.id === inst.classId);
                return (
                  <tr key={inst.id} className="border-b border-white/5">
                    <td className="px-4 py-2 font-mono text-xs text-accent">{inst.id}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-primary">
                      {cls?.name ?? inst.classId}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={inst.status} />
                    </td>
                    <td className="px-4 py-2">
                      {inst.status === 'active' && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              className="h-7 px-2 font-mono text-[10px] uppercase tracking-widest text-signal-stopped hover:bg-signal-stopped/10"
                            >
                              <Ban className="mr-1 h-3 w-3" />
                              Stop
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="border-border bg-surface">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="font-mono text-sm uppercase tracking-widest">
                                Stop {inst.id}?
                              </AlertDialogTitle>
                              <AlertDialogDescription className="font-sans text-sm text-ink-secondary">
                                This instance will be immediately killed. All pending actions will be denied.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="border-border bg-transparent text-ink-secondary">
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-signal-stopped text-white hover:bg-signal-stopped/90"
                                onClick={() => onStopInstance(inst.id)}
                              >
                                Stop instance
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      {inst.status === 'killed' && (
                        <Button
                          variant="ghost"
                          onClick={() => onResumeInstance(inst.id)}
                          className="h-7 px-2 font-mono text-[10px] uppercase tracking-widest text-signal-healthy hover:bg-signal-healthy/10"
                        >
                          <Play className="mr-1 h-3 w-3" />
                          Resume
                        </Button>
                      )}
                      {inst.status === 'revoked' && (
                        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                          Use agent detail to manage
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Stop history */}
      <Panel title="Stop / Resume History">
        <div className="flex flex-col">
          {stopEvents.length === 0 ? (
            <div className="p-6 text-center font-mono text-xs text-ink-secondary">
              No stop or resume events recorded.
            </div>
          ) : (
            stopEvents.map((evt) => (
              <div
                key={evt.id}
                className="flex items-center gap-3 border-b border-white/5 px-4 py-3 last:border-0"
              >
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center border',
                    evt.action === 'stop'
                      ? 'border-signal-stopped/20 bg-signal-stopped/5'
                      : 'border-signal-healthy/30 bg-signal-healthy/10'
                  )}
                >
                  {evt.action === 'stop' ? (
                    <Octagon className="h-3.5 w-3.5 text-signal-stopped" />
                  ) : (
                    <Play className="h-3.5 w-3.5 text-signal-healthy" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-ink-primary">
                      {evt.action === 'stop' ? 'Stop' : 'Resume'}
                    </span>
                    <span
                      className={cn(
                        'font-mono text-[10px] uppercase tracking-widest',
                        evt.action === 'stop' ? 'text-signal-stopped' : 'text-signal-healthy'
                      )}
                    >
                      {evt.scope}
                    </span>
                    {evt.targetName && (
                      <span className="font-mono text-[10px] text-ink-secondary">
                        {evt.targetName}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 font-sans text-[11px] text-ink-secondary">{evt.reason}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[10px] text-ink-secondary">
                    {evt.operator}
                  </div>
                  <div className="font-mono text-[10px] text-ink-secondary/60">
                    {formatRelative(evt.timestamp)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
