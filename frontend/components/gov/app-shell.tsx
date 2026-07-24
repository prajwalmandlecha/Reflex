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

import { useWebSocket } from '@/hooks/useWebSocket';

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
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  const { isConnected: isFleetWsConnected } = useWebSocket('/ws/fleet');
  const { history: wsAlerts } = useWebSocket<AlertItem>('/ws/alerts');
  const { history: wsActivities } = useWebSocket<ActivityEvent>('/ws/activity');

  useEffect(() => {
    if (wsAlerts.length > 0) {
      setAlertItems((prev) => {
        const ids = new Set(prev.map((a) => a.id));
        const newItems = wsAlerts.filter((a) => !ids.has(a.id));
        return [...newItems, ...prev];
      });
    }
  }, [wsAlerts]);

  useEffect(() => {
    if (wsActivities.length > 0) {
      setActivityFeed((prev) => {
        const ids = new Set(prev.map((a) => a.id));
        const newItems = wsActivities.filter((a) => !ids.has(a.id));
        return [...newItems, ...prev];
      });
    }
  }, [wsActivities]);

  // Global Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input, textarea, or select
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      } else if (e.key === 'Escape') {
        setSelectedAgentId(null);
        setShowShortcutsModal(false);
      } else if (e.shiftKey && e.key.toUpperCase() === 'E') {
        e.preventDefault();
        setView('estop');
      } else if (e.shiftKey && e.key.toUpperCase() === 'C') {
        e.preventDefault();
        setView('command');
      } else if (e.shiftKey && e.key.toUpperCase() === 'A') {
        e.preventDefault();
        setView('activity');
      } else if (e.shiftKey && e.key.toUpperCase() === 'L') {
        e.preventDefault();
        setView('audit');
      } else if (e.shiftKey && e.key.toUpperCase() === 'P') {
        e.preventDefault();
        setView('policies');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const reloadData = useCallback(() => {
    api.getAgentInstances().then(setInstances).catch(() => {});
    api.getAgentClasses().then(setClasses).catch(() => {});
    api.getBankConnections().then(setConnections).catch(() => {});
    api.getPolicies().then(setPolicies).catch(() => {});
    api.getAuditLog().then(setAuditEntries).catch(() => {});
    api.getFleetStatus().then((res) => {
      if (res && res.status) setFleetStatus(res.status);
    }).catch(() => {});
    api.getDashboardActivity().then((act) => {
      if (Array.isArray(act)) setActivityFeed(act);
    }).catch(() => {});
    api.getDashboardSummary().then((sum) => {
      if (sum) {
        setFleetSpend({
          spent: sum.spend_today_usd ?? sum.spend_today ?? 0,
          cap: sum.total_cap_usd ?? 100000,
        });
        setDenialsLastHour(sum.denials_last_hour ?? 0);
      }
    }).catch(() => {});
    api.getStopEvents().then((evs) => {
      if (Array.isArray(evs)) setStopEvents(evs);
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
            <div className="h-4 w-[1px] bg-[#232B35]" />
            {/* Live Stream Heartbeat Indicator */}
            <div
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono border transition-colors',
                isFleetWsConnected
                  ? 'bg-[#3DDC84]/10 border-[#3DDC84]/20 text-[#3DDC84]'
                  : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              )}
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full animate-pulse',
                  isFleetWsConnected ? 'bg-[#3DDC84]' : 'bg-amber-400'
                )}
              />
              <span>{isFleetWsConnected ? 'STREAM ACTIVE' : 'STREAM POLLING'}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowShortcutsModal(true)}
              className="px-2.5 py-1 rounded border border-[#232B35] bg-[#131A22] text-[#8B96A3] hover:text-[#E4E9EE] hover:bg-[#232B35]/50 font-mono text-xs transition-colors flex items-center gap-1"
              title="Keyboard Shortcuts (?)"
            >
              <span className="text-[10px] text-[#4C8DFF]">?</span>
              <span>Shortcuts</span>
            </button>

            <EmergencyStopControl
              isStopped={fleetStatus === 'stopped'}
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
          {view === 'policies' && <PoliciesView policies={policies} classes={classes} onRefresh={reloadData} />}
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
              fleetStatus={fleetStatus}
              onStopInstance={handleRevokeAgent}
              onStopClass={(classId) => api.revokeAgentClass(classId).then(reloadData)}
              onStopFleet={() => handleFleetAction('stop')}
              onResumeFleet={() => handleFleetAction('resume')}
              onResumeInstance={handleReviveAgent}
            />
          )}
          {view === 'settings' && <SettingsView operator={operator} />}
        </main>
      </div>

      {/* Keyboard Shortcuts Modal */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md border border-[#232B35] bg-[#131A22] p-5 shadow-2xl rounded-lg">
            <div className="flex items-center justify-between border-b border-[#232B35] pb-3 mb-4">
              <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-[#E4E9EE]">
                Operator Keyboard Shortcuts
              </h3>
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="font-mono text-xs text-[#8B96A3] hover:text-[#E4E9EE]"
              >
                ✕ Esc
              </button>
            </div>
            <div className="space-y-2.5 font-mono text-xs">
              {[
                { key: 'Shift + C', desc: 'Command Center' },
                { key: 'Shift + A', desc: 'Activity Feed' },
                { key: 'Shift + L', desc: 'Audit Log' },
                { key: 'Shift + P', desc: 'Policies' },
                { key: 'Shift + E', desc: 'Emergency Stop' },
                { key: 'Esc', desc: 'Clear Selection / Close Modal' },
                { key: '?', desc: 'Toggle Shortcuts Help' },
              ].map((sc) => (
                <div key={sc.key} className="flex items-center justify-between py-1 border-b border-white/5 last:border-0">
                  <span className="px-2 py-0.5 rounded bg-[#0B0F14] border border-[#232B35] text-[#4C8DFF] font-semibold">
                    {sc.key}
                  </span>
                  <span className="text-[#8B96A3]">{sc.desc}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 pt-3 border-t border-[#232B35] text-right">
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="px-3 py-1.5 rounded bg-[#4C8DFF] text-white font-mono text-xs hover:bg-[#4C8DFF]/90 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
