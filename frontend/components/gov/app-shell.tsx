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
  Globe,
  Menu,
  X,
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
import { FleetCapsView } from '@/components/views/fleet-caps';

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
  | 'fleetcaps'
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
  { id: 'fleetcaps', label: 'Fleet Caps', icon: Globe, allowedRoles: ['admin'] },
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    // Warm-up cascade: this single call makes the backend ping Redis + gateway
    // + DB, waking every scale-to-zero service in one round-trip on first load.
    api.getSystemHealth().catch(() => {
      // Non-fatal — the Settings view re-probes on its own interval.
    });
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
      <div className="min-h-screen bg-bg-deep text-ink-primary flex items-center justify-center font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-accent animate-ping" />
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

  const sidebarContent = (
    <>
      <div className="p-4 border-b border-white/[0.05] flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-mono font-bold text-white text-xs shadow-md shadow-blue-500/20 border border-white/20">
          AGP
        </div>
        <div>
          <div className="font-mono font-bold text-xs text-white tracking-tight">
            REFLEX AGP
          </div>
          <div className="text-[10px] font-mono text-ink-secondary">
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
              onClick={() => {
                setView(item.id);
                setSidebarOpen(false);
              }}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-mono transition-all text-left cursor-pointer',
                active
                  ? 'bg-accent/10 text-accent font-semibold border border-accent/25 shadow-[0_0_12px_rgba(76,141,255,0.1)]'
                  : 'text-ink-secondary hover:text-white hover:bg-white/[0.04]'
              )}
            >
              <Icon className={cn('w-4 h-4', active ? 'text-accent' : 'text-ink-secondary')} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* User Profile Footer */}
      <div className="p-3 border-t border-white/[0.05] bg-black/20 space-y-2">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1 pr-2">
            <div className="text-xs font-mono font-bold text-ink-primary truncate">
              {user.full_name}
            </div>
            <div className="text-[10px] font-mono text-ink-secondary truncate">
              {user.email}
            </div>
          </div>
          {getRoleBadge(user.role)}
        </div>

        <div className="pt-2 border-t border-white/[0.04] flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-ink-secondary">
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
            className="p-1 rounded text-ink-secondary hover:text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center gap-1 font-mono text-[10px]"
            title="Sign Out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-bg-deep text-ink-primary flex font-sans antialiased">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 bg-[#0b1018]/90 border-r border-white/[0.05] backdrop-blur-xl flex-col flex-shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface border-r border-border flex flex-col shadow-2xl">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-4 p-1 rounded text-ink-secondary hover:text-ink-primary hover:bg-border/40 transition-colors"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-14 bg-[#0b1018]/80 border-b border-white/[0.05] backdrop-blur-xl px-4 md:px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-lg text-ink-secondary hover:text-ink-primary hover:bg-white/[0.06] transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <StatusBadge status={fleetStatus} />
            <div className="h-4 w-[1px] bg-white/[0.06]" />
            <div className="text-xs font-mono text-ink-secondary">
              Active Fleet: <span className="text-white font-semibold">{instances.filter(i => i.status === 'active').length}</span> / {instances.length}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setShowHelpModal(true)}
              className="px-2.5 py-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-ink-secondary hover:text-white hover:bg-white/[0.06] hover:border-white/[0.12] font-mono text-xs transition-all flex items-center gap-1.5 cursor-pointer"
              title="Getting Started Guide"
            >
              <HelpCircle className="w-3.5 h-3.5 text-accent" />
              <span>Help</span>
            </button>

            <button
              onClick={() => setShowShortcutsModal(true)}
              className="px-2.5 py-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-ink-secondary hover:text-white hover:bg-white/[0.06] hover:border-white/[0.12] font-mono text-xs transition-all flex items-center gap-1 cursor-pointer"
              title="Keyboard Shortcuts (?)"
            >
              <span className="text-[10px] text-accent">?</span>
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
          {view === 'fleetcaps' && <FleetCapsView onRefresh={reloadData} />}
          {view === 'settings' && <SettingsView operator={operatorName} />}
        </main>
      </div>

      {/* Getting Started / Help Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg border border-border bg-surface p-5 shadow-2xl rounded-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-ink-primary flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-accent" />
                Getting Started
              </h3>
              <button
                onClick={() => setShowHelpModal(false)}
                className="font-mono text-xs text-ink-secondary hover:text-ink-primary"
              >
                ✕ Esc
              </button>
            </div>

            <p className="text-xs text-ink-secondary mb-4 leading-relaxed">
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
                <div key={s.step} className="flex gap-3 rounded-lg border border-border bg-bg-deep/60 p-3">
                  <div className="w-6 h-6 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center font-mono text-xs font-bold text-accent flex-shrink-0">
                    {s.step}
                  </div>
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-ink-primary mb-1 flex items-center gap-2 flex-wrap">
                      {s.title}
                      <button
                        onClick={() => {
                          setView(s.viewId);
                          setShowHelpModal(false);
                        }}
                        className="px-1.5 py-0.5 rounded border border-accent/30 bg-accent/10 text-[10px] font-mono text-accent hover:bg-accent/20 transition-colors"
                      >
                        Open {s.linkLabel} →
                      </button>
                    </div>
                    <p className="text-[11px] text-ink-secondary leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-3 border-t border-border flex items-center justify-between">
              <label className="flex items-center gap-2 font-mono text-[11px] text-ink-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideHelpOnStartup}
                  onChange={(e) => toggleHideHelpOnStartup(e.target.checked)}
                  className="accent-accent"
                />
                Don&apos;t show on startup
              </label>
              <button
                onClick={() => setShowHelpModal(false)}
                className="px-3 py-1.5 rounded bg-accent text-white font-mono text-xs hover:bg-accent/90 transition-colors"
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
          <div className="w-full max-w-md border border-border bg-surface p-5 shadow-2xl rounded-lg">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-ink-primary">
                Operator Keyboard Shortcuts
              </h3>
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="font-mono text-xs text-ink-secondary hover:text-ink-primary"
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
                  <span className="px-2 py-0.5 rounded bg-bg-deep border border-border text-accent font-semibold">
                    {sc.key}
                  </span>
                  <span className="text-ink-secondary">{sc.desc}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 pt-3 border-t border-border text-right">
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="px-3 py-1.5 rounded bg-accent text-white font-mono text-xs hover:bg-accent/90 transition-colors"
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
