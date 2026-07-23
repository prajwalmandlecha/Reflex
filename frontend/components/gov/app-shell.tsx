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
  Gauge,
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
import { PerformanceView } from '@/components/views/performance';
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
  | 'performance'
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
  { id: 'performance', label: 'Performance & Latency', icon: Gauge },
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

  const reloadData = useCallback(() => {
    api.getAgentInstances().then(setInstances).catch(() => {});
    api.getAgentClasses().then(setClasses).catch(() => {});
    api.getBankConnections().then(setConnections).catch(() => {});
    api.getPolicies().then(setPolicies).catch(() => {});
    api.getAuditLog().then(setAuditEntries).catch(() => {});
    api.getFleetStatus().then((res) => {
      if (res && res.status) setFleetStatus(res.status);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    reloadData();
    const timer = setInterval(reloadData, 5000);
    return () => clearInterval(timer);
  }, [reloadData]);

  const handleFleetAction = async (action: 'stop' | 'resume') => {
    if (action === 'stop') {
      await api.haltFleet();
    } else {
      await api.resumeFleet();
    }
    reloadData();
  };

  const handleRevokeAgent = async (agentId: string) => {
    await api.revokeAgent(agentId);
    reloadData();
  };

  const handleReviveAgent = async (agentId: string) => {
    await api.reviveAgent(agentId);
    reloadData();
  };

  const navigateToAgents = (filter?: { classId?: string; status?: string }) => {
    setAgentsFilter(filter || null);
    setView('agents');
  };

  const navigateToAgentDetail = (agentId: string) => {
    setSelectedAgentId(agentId);
    setView('agents');
  };

  return (
    <div className="min-h-screen bg-[#0B0F14] text-[#E4E9EE] flex font-sans antialiased">
      {/* Sidebar */}
      <aside className="w-64 bg-[#131A22] border-r border-[#232B35] flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-[#232B35] flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center font-mono font-bold text-white text-sm shadow-md">
            AGP
          </div>
          <div>
            <div className="font-mono font-bold text-sm text-[#E4E9EE] tracking-tight">
              REFLEX AGP
            </div>
            <div className="text-[10px] font-mono text-[#8B96A3]">
              AI Governance Control Plane
            </div>
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-mono transition-colors text-left',
                  active
                    ? 'bg-[#4C8DFF]/15 text-[#4C8DFF] font-semibold border border-[#4C8DFF]/30'
                    : 'text-[#8B96A3] hover:text-[#E4E9EE] hover:bg-[#232B35]/40'
                )}
              >
                <Icon className={cn('w-4 h-4', active ? 'text-[#4C8DFF]' : 'text-[#8B96A3]')} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[#232B35] text-[11px] font-mono text-[#8B96A3] flex justify-between items-center bg-[#0B0F14]/50">
          <span>Operator: <strong className="text-[#E4E9EE]">{operator}</strong></span>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="System Online" />
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-14 bg-[#131A22] border-b border-[#232B35] px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <StatusBadge status={fleetStatus} />
            <div className="h-4 w-[1px] bg-[#232B35]" />
            <div className="text-xs font-mono text-[#8B96A3]">
              Active Fleet: <span className="text-[#E4E9EE] font-semibold">{instances.filter(i => i.status === 'active').length}</span> / {instances.length}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <EmergencyStopControl
              onConfirm={() => handleFleetAction(fleetStatus === 'stopped' ? 'resume' : 'stop')}
            />
          </div>
        </header>

        {/* View Router */}
        <main className="flex-1 overflow-y-auto p-6">
          {view === 'command' && (
            <CommandCenterView
              instances={instances}
              classes={classes}
              alerts={alertItems}
              activityFeed={activityFeed}
              fleetStatus={fleetStatus}
              fleetSpend={fleetSpend}
              denialsLastHour={denialsLastHour}
              onAgentClick={navigateToAgentDetail}
              onNavigateAgents={navigateToAgents}
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
              onRefresh={reloadData}
            />
          )}
          {view === 'classes' && <AgentClassesView classes={classes} instances={instances} onRefresh={reloadData} />}
          {view === 'policies' && <PoliciesView policies={policies} classes={classes} />}
          {view === 'bank' && <BankConnectionsView connections={connections} onRefresh={reloadData} />}
          {view === 'activity' && <ActivityView activityFeed={activityFeed} classes={classes} />}
          {view === 'performance' && <PerformanceView />}
          {view === 'audit' && <AuditLogView entries={auditEntries} />}
          {view === 'estop' && (
            <EmergencyStopView
              instances={instances}
              classes={classes}
              stopEvents={stopEvents}
              operator={operator}
              onStopInstance={handleRevokeAgent}
              onStopClass={(classId) => api.revokeAgentClass(classId).then(reloadData)}
              onStopFleet={() => handleFleetAction('stop')}
              onResumeInstance={handleReviveAgent}
            />
          )}
          {view === 'settings' && <SettingsView operator={operator} />}
        </main>
      </div>
    </div>
  );
}
