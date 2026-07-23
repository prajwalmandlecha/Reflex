'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type {
  AgentInstance,
  AgentClass,
  BankConnection,
  Policy,
  ActivityEvent,
  AuditLogEntry,
  StopEvent,
  AlertItem,
  FleetStatus,
} from '@/lib/types';
import {
  generateActivityEvent,
  seedActivityFeed,
} from '@/lib/mock-data';
import { EmergencyStopControl } from '@/components/gov/emergency-stop';
import { StatusBadge } from '@/components/gov/status-badge';
import { formatCurrency } from '@/lib/format';
import {
  LayoutDashboard,
  Bot,
  Boxes,
  ScrollText,
  Plug,
  Activity,
  FileClock,
  Octagon,
  Settings,
  Bell,
} from 'lucide-react';

import { CommandCenterView } from '@/components/views/command-center';
import { AgentsView } from '@/components/views/agents';
import { AgentClassesView } from '@/components/views/agent-classes';
import { PoliciesView } from '@/components/views/policies';
import { BankConnectionsView } from '@/components/views/bank-connections';
import { ActivityView } from '@/components/views/activity';
import { AuditLogView } from '@/components/views/audit-log';
import { EmergencyStopView } from '@/components/views/emergency-stop';
import { SettingsView } from '@/components/views/settings';

export type ViewId =
  | 'command'
  | 'agents'
  | 'classes'
  | 'policies'
  | 'bank'
  | 'activity'
  | 'audit'
  | 'estop'
  | 'settings';

const navItems: { id: ViewId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'command', label: 'Command Center', icon: LayoutDashboard },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'classes', label: 'Agent Classes', icon: Boxes },
  { id: 'policies', label: 'Policies', icon: ScrollText },
  { id: 'bank', label: 'Bank Connections', icon: Plug },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'audit', label: 'Audit Log', icon: FileClock },
  { id: 'estop', label: 'Emergency Stop', icon: Octagon },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function AppShell() {
  const [view, setView] = useState<ViewId>('command');
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [classes, setClasses] = useState<AgentClass[]>([]);
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [stopEvents, setStopEvents] = useState<StopEvent[]>([]);
  const [alertItems, setAlertItems] = useState<AlertItem[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  const [operator, setOperator] = useState('m.chen');
  const [fleetStatus, setFleetStatus] = useState<FleetStatus>('healthy');
  const [fleetSpend, setFleetSpend] = useState({ spent: 0, cap: 0 });
  const [denialsLastHour, setDenialsLastHour] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentsFilter, setAgentsFilter] = useState<{ classId?: string; status?: string } | null>(null);

  useEffect(() => {
    api.getAgentInstances().then(setInstances);
    api.getAgentClasses().then(setClasses);
    api.getBankConnections().then(setConnections);
    api.getPolicies().then(setPolicies);
    api.getAuditLog().then(setAuditEntries);
    api.getStopEvents().then(setStopEvents);
    api.getAlerts().then(setAlertItems);
    api.getOperator().then(setOperator);
    setActivityFeed(seedActivityFeed(30));
  }, []);

  useEffect(() => {
    setFleetStatus(api.computeFleetStatus(instances));
    setFleetSpend(api.computeFleetSpend(instances));
  }, [instances]);

  useEffect(() => {
    const interval = setInterval(() => {
      const evt = generateActivityEvent();
      setActivityFeed((prev) => [evt, ...prev].slice(0, 200));
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setDenialsLastHour(api.countDenialsLastHour(activityFeed));
  }, [activityFeed]);

  const handleEmergencyStop = useCallback(() => {
    setInstances((prev) => prev.map((i) => ({ ...i, status: 'killed' as const })));
    setStopEvents((prev) => [
      {
        id: `stop-${Date.now()}`,
        timestamp: new Date().toISOString(),
        scope: 'fleet',
        action: 'stop',
        operator,
        reason: 'Manual fleet-wide emergency stop from top bar',
      },
      ...prev,
    ]);
    setAlertItems((prev) => [
      {
        id: `alert-${Date.now()}`,
        timestamp: new Date().toISOString(),
        severity: 'critical',
        category: 'emergency_stop',
        title: 'FLEET-WIDE EMERGENCY STOP TRIGGERED',
        detail: `Operator ${operator} triggered a fleet-wide emergency stop. All agents killed.`,
        source: 'Emergency Stop Control',
      },
      ...prev,
    ]);
  }, [operator]);

  const navigateToAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    setView('agents');
  }, []);

  const navigateToAgentsFiltered = useCallback((filter: { classId?: string; status?: string }) => {
    setAgentsFilter(filter);
    setSelectedAgentId(null);
    setView('agents');
  }, []);

  const activeAgents = instances.filter((i) => i.status === 'active').length;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-deep text-ink-primary">
      {/* Top status bar — glass */}
      <header className="glass-strong z-20 flex h-14 shrink-0 items-center justify-between border-b border-white/5 px-5">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 shadow-[0_0_16px_-4px_rgba(76,141,255,0.4)]">
              <Octagon className="h-4 w-4 text-accent" />
            </div>
            <span className="font-mono text-xs font-semibold uppercase tracking-widest text-ink-primary">
              Governance Control Center
            </span>
          </div>
          <div className="flex items-center gap-2 border-l border-white/10 pl-5">
            <StatusBadge status={fleetStatus} size="sm" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
              {activeAgents} agents active
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <EmergencyStopControl onConfirm={handleEmergencyStop} compact />
          <div className="flex items-center gap-2 border-l border-white/10 pl-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
              <Bell className="h-3.5 w-3.5 text-ink-secondary" />
            </div>
            <span className="font-mono text-xs text-ink-secondary">{operator}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left nav rail — glass */}
        <nav className="z-10 flex w-48 shrink-0 flex-col border-r border-white/5 bg-white/[0.02] py-3 backdrop-blur-xl">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setView(item.id);
                  if (item.id !== 'agents') {
                    setSelectedAgentId(null);
                    setAgentsFilter(null);
                  }
                }}
                className={cn(
                  'group mx-2 flex items-center gap-2.5 rounded-xl px-3 py-2 text-left font-mono text-xs uppercase tracking-wider transition-all',
                  isActive
                    ? 'bg-accent/10 text-accent shadow-[0_0_16px_-6px_rgba(76,141,255,0.4)]'
                    : 'text-ink-secondary hover:bg-white/5 hover:text-ink-primary'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </button>
            );
          })}
          <div className="mt-auto px-3 py-3">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <div className="font-mono text-[9px] uppercase tracking-widest text-ink-secondary/60">
                Fleet Spend Today
              </div>
              <div className="mt-0.5 font-mono text-sm text-ink-primary tabular">
                {formatCurrency(fleetSpend.spent)}
              </div>
              <div className="font-mono text-[10px] text-ink-secondary tabular">
                of {formatCurrency(fleetSpend.cap)} cap
              </div>
            </div>
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          {view === 'command' && (
            <CommandCenterView
              instances={instances}
              classes={classes}
              alerts={alertItems}
              activityFeed={activityFeed}
              fleetStatus={fleetStatus}
              fleetSpend={fleetSpend}
              denialsLastHour={denialsLastHour}
              onAgentClick={navigateToAgent}
              onNavigateAgents={navigateToAgentsFiltered}
              onNavigatePolicies={() => setView('policies')}
              onNavigateAudit={() => setView('audit')}
            />
          )}
          {view === 'agents' && (
            <AgentsView
              instances={instances}
              classes={classes}
              activityFeed={activityFeed}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
              initialFilter={agentsFilter}
            />
          )}
          {view === 'classes' && (
            <AgentClassesView classes={classes} instances={instances} />
          )}
          {view === 'policies' && (
            <PoliciesView policies={policies} classes={classes} />
          )}
          {view === 'bank' && <BankConnectionsView connections={connections} />}
          {view === 'activity' && (
            <ActivityView activityFeed={activityFeed} classes={classes} />
          )}
          {view === 'audit' && <AuditLogView entries={auditEntries} />}
          {view === 'estop' && (
            <EmergencyStopView
              instances={instances}
              classes={classes}
              stopEvents={stopEvents}
              operator={operator}
              onStopInstance={(id) =>
                setInstances((prev) =>
                  prev.map((i) => (i.id === id ? { ...i, status: 'killed' as const } : i))
                )
              }
              onStopClass={(classId) =>
                setInstances((prev) =>
                  prev.map((i) =>
                    i.classId === classId ? { ...i, status: 'killed' as const } : i
                  )
                )
              }
              onStopFleet={handleEmergencyStop}
              onResumeInstance={(id) =>
                setInstances((prev) =>
                  prev.map((i) => (i.id === id ? { ...i, status: 'active' as const } : i))
                )
              }
            />
          )}
          {view === 'settings' && <SettingsView operator={operator} />}
        </main>
      </div>
    </div>
  );
}
