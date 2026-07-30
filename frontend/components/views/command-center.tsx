'use client';

import { cn } from '@/lib/utils';
import { FleetMonitor } from '@/components/gov/fleet-monitor';
import { Panel, StatTile } from '@/components/gov/panel';
import { StatusBadge } from '@/components/gov/status-badge';
import { SpendBar } from '@/components/gov/spend-bar';
import { formatCurrency, formatNumber, formatRelative } from '@/lib/format';
import type { AgentInstance, AgentClass, AlertItem, ActivityEvent, FleetStatus } from '@/lib/types';
import { ArrowRight, AlertTriangle, ShieldAlert, ScrollText } from 'lucide-react';

const alertIcon: Record<string, any> = {
  critical: ShieldAlert,
  warning: AlertTriangle,
  info: ScrollText,
  error: ShieldAlert,
  deny: AlertTriangle,
};

const alertColor: Record<string, string> = {
  critical: 'text-signal-stopped',
  warning: 'text-signal-caution',
  info: 'text-accent',
  error: 'text-signal-stopped',
  deny: 'text-signal-caution',
};

export function CommandCenterView({
  instances,
  classes,
  alerts,
  activityFeed,
  fleetStatus,
  fleetSpend,
  denialsLastHour,
  onAgentClick,
  onNavigateAgents,
  onNavigatePolicies,
  onNavigateAudit,
}: {
  instances: AgentInstance[];
  classes: AgentClass[];
  alerts: AlertItem[];
  activityFeed: ActivityEvent[];
  fleetStatus: FleetStatus;
  fleetSpend: { spent: number; cap: number };
  denialsLastHour: number;
  onAgentClick: (id: string) => void;
  onNavigateAgents: (filter: { classId?: string; status?: string }) => void;
  onNavigatePolicies: () => void;
  onNavigateAudit: () => void;
}) {
  const activeAgents = instances.filter((i) => i.status === 'active').length;
  const revokedAgents = instances.filter((i) => i.status === 'revoked').length;
  const killedAgents = instances.filter((i) => i.status === 'killed').length;
  const recentActivity = activityFeed.slice(0, 8);

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Agents Active"
          value={`${activeAgents} / ${instances.length}`}
          sub={`${revokedAgents} revoked · ${killedAgents} killed`}
          accent={fleetStatus === 'healthy' ? 'healthy' : fleetStatus === 'degraded' ? 'caution' : 'stopped'}
        />
        <StatTile
          label="Spend Today"
          value={formatCurrency(fleetSpend.spent)}
          sub={fleetSpend.cap > 0 ? `of ${formatCurrency(fleetSpend.cap)} total cap` : 'no fleet-wide cap configured'}
          accent={fleetSpend.cap > 0 && fleetSpend.spent / fleetSpend.cap > 0.8 ? 'caution' : 'accent'}
        />
        <StatTile
          label="Denials (1h)"
          value={formatNumber(denialsLastHour)}
          sub="actions blocked by policy"
          accent={denialsLastHour > 5 ? 'caution' : 'accent'}
        />
        <StatTile
          label="Fleet Status"
          value={<StatusBadge status={fleetStatus} size="md" />}
          sub={fleetStatus === 'healthy' ? 'all systems nominal' : fleetStatus === 'degraded' ? 'revoked agents present' : 'agents killed'}
          accent={fleetStatus === 'healthy' ? 'healthy' : fleetStatus === 'degraded' ? 'caution' : 'stopped'}
        />
      </div>

      {/* Fleet Monitor (replaces Fleet Radar) */}
      <FleetMonitor
        instances={instances}
        classes={classes}
        activityFeed={activityFeed}
        onAgentClick={onAgentClick}
      />

      {/* Alerts + Spend by class + Recent activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent alerts */}
        <Panel
          title="Recent Alerts"
          className="lg:col-span-1"
        >
          <div className="flex max-h-[380px] flex-col overflow-auto">
            {alerts.length === 0 ? (
              <div className="p-6 text-center font-mono text-xs text-ink-secondary">
                No alerts — fleet is quiet.
              </div>
            ) : (
              alerts.map((alert) => {
                const Icon = alertIcon[alert.severity] || AlertTriangle;
                const color = alertColor[alert.severity] || 'text-signal-caution';
                return (
                  <div
                    key={alert.id}
                    className="border-b border-white/5 px-4 py-3 last:border-0 transition-colors hover:bg-white/[0.02]"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/5', color)}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-xs text-ink-primary">
                            {alert.title}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-ink-secondary">
                            {formatRelative(alert.timestamp)}
                          </span>
                        </div>
                        <p className="mt-0.5 font-sans text-[11px] leading-snug text-ink-secondary">
                          {alert.detail}
                        </p>
                        <span className="mt-1 inline-block font-mono text-[9px] uppercase tracking-widest text-ink-secondary/60">
                          {alert.source}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Panel>

        {/* Spend by class */}
        <Panel
          title="Spend by Class"
          action={
            <button
              onClick={onNavigatePolicies}
              className="font-mono text-[10px] uppercase tracking-widest text-accent hover:underline"
            >
              Manage policies
            </button>
          }
        >
          <div className="flex flex-col">
            {classes.map((cls) => {
              const clsInstances = instances.filter((i) => i.classId === cls.id);
              const clsSpend = clsInstances.reduce((s, i) => s + i.spendToday, 0);
              const clsCap = clsInstances.reduce((s, i) => s + i.capToday, 0);
              return (
                <div
                  key={cls.id}
                  className="border-b border-white/5 px-4 py-3 last:border-0 transition-colors hover:bg-white/[0.02]"
                >
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => onNavigateAgents({ classId: cls.id })}
                      className="font-mono text-xs text-ink-primary hover:text-accent"
                    >
                      {cls.name}
                    </button>
                    <span className="font-mono text-xs text-ink-secondary tabular">
                      {formatCurrency(clsSpend)} / {formatCurrency(clsCap)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <SpendBar used={clsSpend} cap={clsCap} />
                  </div>
                  <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-ink-secondary">
                    <span>{clsInstances.length} instances</span>
                    <span>·</span>
                    <span>{(cls.allowedTools || cls.defaultAllowedTools || []).length} tools</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Recent activity */}
        <Panel
          title="Recent Activity"
          action={
            <button
              onClick={() => onNavigateAudit()}
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-accent hover:underline"
            >
              Audit log <ArrowRight className="h-3 w-3" />
            </button>
          }
        >
          <div className="flex max-h-[380px] flex-col overflow-auto">
            {recentActivity.map((evt) => (
              <div
                key={evt.id}
                className="flex items-center gap-3 border-b border-white/5 px-4 py-2 last:border-0 transition-colors hover:bg-white/[0.02]"
              >
                <span
                  className={cn(
                    'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                    evt.decision === 'allow' ? 'bg-signal-healthy' : 'bg-signal-stopped'
                  )}
                />
                <span className="shrink-0 font-mono text-[10px] text-ink-secondary">
                  {evt.agentId}
                </span>
                <span className="flex-1 truncate font-mono text-xs text-ink-primary">
                  {evt.action}
                </span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-[10px] uppercase tracking-wider',
                    evt.decision === 'allow' ? 'text-signal-healthy' : 'text-signal-stopped'
                  )}
                >
                  {evt.decision}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-ink-secondary tabular">
                  {evt.latencyMs}ms
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
