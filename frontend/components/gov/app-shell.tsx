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
  HelpCircle,
  Users,
  LogOut,
  ShieldCheck,
  Shield,
  Info,
} from 'lucide-react';

import { useWebSocket } from '@/hooks/useWebSocket';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { LoginView } from '@/components/views/login';

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
import { UsersView } from '@/components/views/users';

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
  | 'settings'
  | 'users';

const navItems: {
  id: ViewId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  allowedRoles: ('admin' | 'operator' | 'auditor')[];
}[] = [
  { id: 'command', label: 'Command Center', icon: LayoutDashboard, allowedRoles: ['admin', 'operator'] },
  { id: 'agents', label: 'Agents', icon: Bot, allowedRoles: ['admin', 'operator'] },
  { id: 'classes', label: 'Agent Classes', icon: Boxes, allowedRoles: ['admin', 'operator'] },
  { id: 'policies', label: 'Policies', icon: ScrollText, allowedRoles: ['admin', 'operator'] },
  { id: 'bank', label: 'Bank Connections', icon: Plug, allowedRoles: ['admin', 'operator'] },
  { id: 'activity', label: 'Activity', icon: Activity, allowedRoles: ['admin', 'operator'] },
  { id: 'performance', label: 'Performance & Latency', icon: Gauge, allowedRoles: ['admin', 'operator'] },
  { id: 'audit', label: 'Audit Log', icon: FileClock, allowedRoles: ['admin', 'auditor'] },
  { id: 'estop', label: 'Emergency Stop', icon: Octagon, allowedRoles: ['admin', 'operator'] },
  { id: 'users', label: 'User Management', icon: Users, allowedRoles: ['admin'] },
  { id: 'settings', label: 'Settings', icon: Settings, allowedRoles: ['admin'] },
];

export function AppShell() {
  return (
    <AuthProvider>
      <AppShellContent />
    </AuthProvider>
  );
}

function AppShellContent() {
  const { user, loading, logout, hasRole, hasPermission } = useAuth();
  const [view, setView] = useState<ViewId>('command');
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [classes, setClasses] = useState<AgentClass[]>([]);
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [stopEvents, setStopEvents] = useState<StopEvent[]>([]);
  const [alertItems, setAlertItems] = useState<AlertItem[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  const [fleetStatus, setFleetStatus] = useState<FleetStatus>('healthy');
  const [fleetSpend, setFleetSpend] = useState({ spent: 0, cap: 0 });
  const [denialsLastHour, setDenialsLastHour] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentsFilter, setAgentsFilter] = useState<{ classId?: string; status?: string } | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [hideHelpOnStartup, setHideHelpOnStartup] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(false);

  const operatorName = user?.full_name || 'Operator';

  // Record an API failure so the operator sees it instead of a silent empty
  // dashboard. Stores a readable message; cleared on the next successful load.
  const noteApiError = useCallback((source: string) => (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    setApiError(`${source}: ${msg}`);
  }, []);

  // Show the getting-started guide on load unless the operator opted out
  useEffect(() => {
    const dismissed = localStorage.getItem('reflex_help_dismissed') === '1';
    setHideHelpOnStartup(dismissed);
    if (!dismissed) setShowHelpModal(true);
  }, []);

  // Redirect user to an allowed view if current view is restricted for their role
  useEffect(() => {
    if (!user) return;
    const allowed = navItems.filter((item) => item.allowedRoles.includes(user.role as any)).map((i) => i.id);
    if (!allowed.includes(view)) {
      setView(user.role === 'auditor' ? 'audit' : 'command');
    }
  }, [user, view]);

  // Pause polling when browser tab is hidden
  useEffect(() => {
    const handler = () => setIsVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  const toggleHideHelpOnStartup = (hide: boolean) => {
    setHideHelpOnStartup(hide);
    localStorage.setItem('reflex_help_dismissed', hide ? '1' : '0');
  };

  const { history: wsAlerts } = useWebSocket<AlertItem>('/ws/alerts');
  const { history: wsActivities, isConnected: isActivityWsConnected } = useWebSocket<ActivityEvent>('/ws/activity');
  const { history: wsFleet } = useWebSocket<any>('/ws/fleet');

  useEffect(() => {
    if (wsFleet.length > 0) {
      api.getFleetStatus().then((res) => {
        if (res && res.status) setFleetStatus(res.status);
      }).catch(() => {});
      api.getAgentInstances().then(setInstances).catch(() => {});
      api.getStopEvents().then((evs) => {
        if (Array.isArray(evs)) setStopEvents(evs);
      }).catch(() => {});
    }
  }, [wsFleet]);

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
        setShowHelpModal(false);
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

  const refreshHeader = useCallback(() => {
    if (!user) return;
    api.getFleetStatus().then((res) => {
      if (res && res.status) setFleetStatus(res.status);
    }).catch(() => {});
    api.getAgentInstances().then(setInstances).catch(() => {});
  }, [user]);

  const fetchForView = useCallback((v: ViewId) => {
    if (!user) return;
    switch (v) {
      case 'command':
        api.getAgentClasses().then(setClasses).catch(() => {});
        api.getDashboardActivity().then((act) => {
          if (Array.isArray(act)) setActivityFeed(act);
        }).catch(() => {});
        api.getDashboardSummary().then((sum) => {
          if (sum) {
            setFleetSpend({
              spent: sum.spend_today_usd ?? sum.spend_today ?? 0,
              cap: sum.total_cap_usd ?? 0,
            });
            setDenialsLastHour(sum.denials_last_hour ?? 0);
          }
        }).catch(() => {});
        break;
      case 'agents':
        api.getAgentClasses().then(setClasses).catch(() => {});
        break;
      case 'classes':
        api.getAgentClasses().then(setClasses).catch(() => {});
        break;
      case 'policies':
        api.getPolicies().then(setPolicies).catch(() => {});
        break;
      case 'bank':
        if (connections.length === 0) {
          setConnectionsLoading(true);
          api.getBankConnections()
            .then(setConnections)
            .catch(() => {})
            .finally(() => setConnectionsLoading(false));
        }
        break;
      case 'activity':
        api.getDashboardActivity().then((act) => {
          if (Array.isArray(act)) setActivityFeed(act);
        }).catch(() => {});
        break;
      case 'audit':
        api.getAuditLog().then(setAuditEntries).catch(() => {});
        break;
      case 'estop':
        api.getAgentClasses().then(setClasses).catch(() => {});
        api.getStopEvents().then((evs) => {
          if (Array.isArray(evs)) setStopEvents(evs);
        }).catch(() => {});
        break;
    }
  }, [user, connections.length]);

  const reloadData = useCallback(() => {
    if (!user) return;
    api.getFleetStatus().then((res) => {
      if (res && res.status) setFleetStatus(res.status);
      setApiError(null);
    }).catch(noteApiError('Backend unreachable'));
    api.getAgentInstances().then(setInstances).catch(noteApiError('Failed to load agents'));
    api.getAgentClasses().then(setClasses).catch(noteApiError('Failed to load classes'));
    api.getBankConnections()
      .then(setConnections)
      .catch(noteApiError('Failed to load connections'))
      .finally(() => setConnectionsLoading(false));
    api.getPolicies().then(setPolicies).catch(noteApiError('Failed to load policies'));
    api.getAuditLog().then(setAuditEntries).catch(noteApiError('Failed to load audit log'));
    api.getDashboardActivity().then((act) => {
      if (Array.isArray(act)) setActivityFeed(act);
    }).catch(noteApiError('Failed to load activity'));
    api.getDashboardSummary().then((sum) => {
      if (sum) {
        setFleetSpend({
          spent: sum.spend_today_usd ?? sum.spend_today ?? 0,
          cap: sum.total_cap_usd ?? 0,
        });
        setDenialsLastHour(sum.denials_last_hour ?? 0);
      }
    }).catch(noteApiError('Failed to load summary'));
    api.getStopEvents().then((evs) => {
      if (Array.isArray(evs)) setStopEvents(evs);
    }).catch(noteApiError('Failed to load stop events'));
  }, [user, noteApiError]);

  useEffect(() => {
    if (user) reloadData();
  }, [user, reloadData]);

  useEffect(() => {
    if (!isVisible || !user) return;
    refreshHeader();
    const timer = setInterval(refreshHeader, 30_000);
    return () => clearInterval(timer);
  }, [isVisible, user, refreshHeader]);

  useEffect(() => {
    if (!isVisible || !user) return;
    fetchForView(view);
    const timer = setInterval(() => fetchForView(view), 10_000);
    return () => clearInterval(timer);
  }, [view, isVisible, user, fetchForView]);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F14] text-[#E4E9EE] flex items-center justify-center font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-[#4C8DFF] animate-ping" />
          <span>Verifying session security credentials...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  const visibleNavItems = navItems.filter((item) =>
    item.allowedRoles.includes(user.role as any)
  );

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return (
          <span className="px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-400 font-mono text-[9px] font-bold uppercase flex items-center gap-1">
            <ShieldCheck className="w-2.5 h-2.5" /> Admin
          </span>
        );
      case 'operator':
        return (
          <span className="px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono text-[9px] font-bold uppercase flex items-center gap-1">
            <Shield className="w-2.5 h-2.5" /> Operator
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 font-mono text-[9px] font-bold uppercase flex items-center gap-1">
            <Info className="w-2.5 h-2.5" /> Auditor
          </span>
        );
    }
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
          {visibleNavItems.map((item) => {
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

        {/* User Profile Footer */}
        <div className="p-3 border-t border-[#232B35] bg-[#0B0F14]/60 space-y-2">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1 pr-2">
              <div className="text-xs font-mono font-bold text-[#E4E9EE] truncate">
                {user.full_name}
              </div>
              <div className="text-[10px] font-mono text-[#8B96A3] truncate">
                {user.email}
              </div>
            </div>
            {getRoleBadge(user.role)}
          </div>

          <div className="pt-2 border-t border-[#232B35]/40 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#8B96A3]">
              <span
                className={cn(
                  'w-2 h-2 rounded-full animate-pulse',
                  fleetStatus === 'healthy' ? 'bg-emerald-500' : fleetStatus === 'degraded' ? 'bg-amber-400' : 'bg-rose-500'
                )}
                title={`Fleet ${fleetStatus}`}
              />
              <span className="capitalize">{fleetStatus}</span>
            </div>

            <button
              onClick={logout}
              className="p-1 rounded text-[#8B96A3] hover:text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center gap-1 font-mono text-[10px]"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
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

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowHelpModal(true)}
              className="px-2.5 py-1 rounded border border-[#232B35] bg-[#131A22] text-[#8B96A3] hover:text-[#E4E9EE] hover:bg-[#232B35]/50 font-mono text-xs transition-colors flex items-center gap-1.5"
              title="Getting Started Guide"
            >
              <HelpCircle className="w-3.5 h-3.5 text-[#4C8DFF]" />
              <span>Help</span>
            </button>

            <button
              onClick={() => setShowShortcutsModal(true)}
              className="px-2.5 py-1 rounded border border-[#232B35] bg-[#131A22] text-[#8B96A3] hover:text-[#E4E9EE] hover:bg-[#232B35]/50 font-mono text-xs transition-colors flex items-center gap-1"
              title="Keyboard Shortcuts (?)"
            >
              <span className="text-[10px] text-[#4C8DFF]">?</span>
              <span>Shortcuts</span>
            </button>

            {/* Hide emergency stop button for Auditor role */}
            {user.role !== 'auditor' && (
              <EmergencyStopControl
                isStopped={fleetStatus === 'stopped'}
                onConfirm={() => handleFleetAction(fleetStatus === 'stopped' ? 'resume' : 'stop')}
              />
            )}
          </div>
        </header>

        {/* API error banner */}
        {apiError && (
          <div className="flex items-center gap-2 border-b border-rose-500/30 bg-rose-500/10 px-6 py-2">
            <span className="inline-block h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
            <span className="font-mono text-[11px] text-rose-300">{apiError}</span>
            <button
              onClick={() => setApiError(null)}
              className="ml-auto font-mono text-[10px] text-rose-400/70 hover:text-rose-300"
            >
              dismiss
            </button>
          </div>
        )}

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
              initialFilter={agentsFilter}
              onRefresh={reloadData}
            />
          )}
          {view === 'classes' && <AgentClassesView classes={classes} instances={instances} onRefresh={reloadData} />}
          {view === 'policies' && <PoliciesView policies={policies} classes={classes} instances={instances} onRefresh={reloadData} />}
          {view === 'bank' && <BankConnectionsView connections={connections} isLoading={connectionsLoading} onRefresh={reloadData} />}
          {view === 'activity' && <ActivityView activityFeed={activityFeed} classes={classes} isStreamConnected={isActivityWsConnected} />}
          {view === 'performance' && <PerformanceView />}
          {view === 'audit' && <AuditLogView entries={auditEntries} />}
          {view === 'estop' && (
            <EmergencyStopView
              instances={instances}
              classes={classes}
              stopEvents={stopEvents}
              operator={operatorName}
              fleetStatus={fleetStatus}
              onStopInstance={handleRevokeAgent}
              onStopClass={(classId) => api.revokeAgentClass(classId).then(reloadData)}
              onStopFleet={() => handleFleetAction('stop')}
              onResumeFleet={() => handleFleetAction('resume')}
              onResumeInstance={handleReviveAgent}
            />
          )}
          {view === 'users' && <UsersView />}
          {view === 'settings' && <SettingsView operator={operatorName} />}
        </main>
      </div>

      {/* Getting Started / Help Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg border border-[#232B35] bg-[#131A22] p-5 shadow-2xl rounded-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#232B35] pb-3 mb-4">
              <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-[#E4E9EE] flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-[#4C8DFF]" />
                Getting Started
              </h3>
              <button
                onClick={() => setShowHelpModal(false)}
                className="font-mono text-xs text-[#8B96A3] hover:text-[#E4E9EE]"
              >
                ✕ Esc
              </button>
            </div>

            <p className="text-xs text-[#8B96A3] mb-4 leading-relaxed">
              Reflex governs how AI agents talk to your banking APIs. Follow these steps to
              onboard and run your first governed agent:
            </p>

            <div className="space-y-3">
              {[
                {
                  step: 1,
                  title: 'Add a Bank Connection',
                  desc: 'Go to Bank Connections and connect an upstream bank — either a REST API (via its OpenAPI spec) or an MCP server. Reflex discovers the available tools/endpoints automatically.',
                  viewId: 'bank' as ViewId,
                  linkLabel: 'Bank Connections',
                },
                {
                  step: 2,
                  title: 'Create an Agent Class',
                  desc: 'In Agent Classes, define a class with its rules and restrictions: allowed tools, spend caps, rate limits, and constraints. Every instance of the class inherits these guardrails.',
                  viewId: 'classes' as ViewId,
                  linkLabel: 'Agent Classes',
                },
                {
                  step: 3,
                  title: 'Register Agent Instances',
                  desc: 'In Agents, register instances of your class. Each instance gets a JWT bearer token minted at registration — copy it and give it to your agent.',
                  viewId: 'agents' as ViewId,
                  linkLabel: 'Agents',
                },
                {
                  step: 4,
                  title: 'Connect Your Agent via the Gateway',
                  desc: 'Point your agent at the Reflex gateway with the minted token in the Authorization header (see the Connection Guide in the Agents tab). Every call is authenticated, policy-checked, and audited.',
                  viewId: 'agents' as ViewId,
                  linkLabel: 'Connection Guide',
                },
                {
                  step: 5,
                  title: 'Monitor & Control',
                  desc: 'Watch live traffic in Command Center and Activity, review the tamper-evident Audit Log, and use Emergency Stop to revoke an instance, a class, or the whole fleet instantly.',
                  viewId: 'command' as ViewId,
                  linkLabel: 'Command Center',
                },
              ].map((s) => (
                <div key={s.step} className="flex gap-3 rounded-lg border border-[#232B35] bg-[#0B0F14]/60 p-3">
                  <div className="w-6 h-6 rounded-full bg-[#4C8DFF]/15 border border-[#4C8DFF]/30 flex items-center justify-center font-mono text-xs font-bold text-[#4C8DFF] flex-shrink-0">
                    {s.step}
                  </div>
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-[#E4E9EE] mb-1 flex items-center gap-2 flex-wrap">
                      {s.title}
                      <button
                        onClick={() => {
                          setView(s.viewId);
                          setShowHelpModal(false);
                        }}
                        className="px-1.5 py-0.5 rounded border border-[#4C8DFF]/30 bg-[#4C8DFF]/10 text-[10px] font-mono text-[#4C8DFF] hover:bg-[#4C8DFF]/20 transition-colors"
                      >
                        Open {s.linkLabel} →
                      </button>
                    </div>
                    <p className="text-[11px] text-[#8B96A3] leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-3 border-t border-[#232B35] flex items-center justify-between">
              <label className="flex items-center gap-2 font-mono text-[11px] text-[#8B96A3] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideHelpOnStartup}
                  onChange={(e) => toggleHideHelpOnStartup(e.target.checked)}
                  className="accent-[#4C8DFF]"
                />
                Don&apos;t show on startup
              </label>
              <button
                onClick={() => setShowHelpModal(false)}
                className="px-3 py-1.5 rounded bg-[#4C8DFF] text-white font-mono text-xs hover:bg-[#4C8DFF]/90 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

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
