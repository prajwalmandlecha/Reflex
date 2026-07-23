import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Bot, Boxes, ScrollText, Plug, Activity,
  FileClock, Octagon, Settings, Bell, ShieldAlert, Network, Shield
} from 'lucide-react';
import { FLEET_METRICS } from '@/services/mockData';

const NAV = [
  { id: 'dashboard',        label: 'Command Center',  icon: LayoutDashboard, path: '/' },
  { id: 'agents',           label: 'Agents',          icon: Bot,            path: '/agents' },
  { id: 'mcp-gateway',      label: 'MCP Gateway',     icon: Network,        path: '/mcp-gateway' },
  { id: 'ai-firewall',      label: 'AI Firewall',     icon: Shield,         path: '/ai-firewall' },
  { id: 'agent-classes',    label: 'Agent Classes',   icon: Boxes,          path: '/agent-classes' },
  { id: 'policies',         label: 'Policies',        icon: ScrollText,     path: '/policies' },
  { id: 'bank-connections', label: 'Connections',     icon: Plug,           path: '/bank-connections' },
  { id: 'activity',         label: 'Live Activity',   icon: Activity,       path: '/activity' },
  { id: 'audit-log',        label: 'Audit Log',       icon: FileClock,      path: '/audit-log' },
  { id: 'emergency-stop',   label: 'Emergency Stop',  icon: Octagon,        path: '/emergency-stop' },
];

export function StatusBadge({ status, label, size = 'sm' }) {
  const colors = { healthy: '#22d07a', caution: '#f5a623', stopped: '#ff4f4f', idle: '#7d8fa8' };
  const c = colors[status] || colors.idle;
  const px = size === 'xs' ? '4px 8px' : '6px 12px';
  const fs = size === 'xs' ? '10px' : '11px';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '8px',
      padding: px,
      borderRadius: '9999px',
      border: `1px solid ${c}30`,
      background: `${c}10`,
      color: c,
      boxShadow: `0 0 16px -4px ${c}40`,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: fs, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.1em',
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: c, flexShrink: 0, boxShadow: `0 0 8px ${c}` }} />
      {label}
    </span>
  );
}

export default function Layout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [holding, setHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = React.useRef(null);

  const fleetStatus = FLEET_METRICS.fleetStatus;
  const statusLabel = fleetStatus === 'healthy' ? 'Fleet Healthy' : fleetStatus === 'caution' ? 'Caution' : 'Halted';

  function startHold() {
    setHolding(true);
    let progress = 0;
    holdTimerRef.current = setInterval(() => {
      progress += 2;
      setHoldProgress(progress);
      if (progress >= 100) {
        clearInterval(holdTimerRef.current);
        navigate('/emergency-stop');
        setHolding(false);
        setHoldProgress(0);
      }
    }, 30);
  }
  function stopHold() {
    clearInterval(holdTimerRef.current);
    setHolding(false);
    setHoldProgress(0);
  }

  const totalSpend = FLEET_METRICS.totalSpend;
  const totalCap = FLEET_METRICS.totalCap;

  return (
    <div className="mesh-bg" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Side Navigation */}
      <aside className="glass-strong" style={{
        width: '260px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        zIndex: 40,
        padding: '24px 16px',
        position: 'relative'
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 8px', marginBottom: '32px', cursor: 'pointer' }} onClick={() => navigate('/')}>
          <div className="glow-accent" style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'linear-gradient(135deg, rgba(79,142,255,0.2) 0%, rgba(79,142,255,0.05) 100%)',
            border: '1px solid rgba(79,142,255,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Octagon size={20} color="#7ab3ff" />
          </div>
          <div>
            <h1 className="font-display gradient-text-blue" style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Guardian AI</h1>
            <p className="font-mono" style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#7d8fa8', margin: 0 }}>Enterprise Control</p>
          </div>
        </div>

        {/* Nav Links */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'visible', paddingRight: '4px' }}>
          {NAV.map(({ id, label, icon: Icon, path }) => {
            const isActive = pathname === path;
            return (
              <button
                key={id}
                onClick={() => navigate(path)}
                className="row-hover"
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  background: isActive ? 'rgba(79,142,255,0.1)' : 'transparent',
                  color: isActive ? '#7ab3ff' : '#7d8fa8',
                  boxShadow: isActive ? 'inset 0 0 0 1px rgba(79,142,255,0.2), 0 4px 12px rgba(79,142,255,0.1)' : 'none',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  position: 'relative'
                }}
              >
                {isActive && <div style={{ position: 'absolute', left: '-16px', top: '50%', transform: 'translateY(-50%)', width: '4px', height: '24px', backgroundColor: '#7ab3ff', borderRadius: '0 4px 4px 0', boxShadow: '0 0 12px #7ab3ff' }} />}
                <Icon size={18} style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7 }} />
                <span className="font-mono" style={{ fontSize: '11px', fontWeight: isActive ? 600 : 500, letterSpacing: '0.05em' }}>{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Settings & Bottom widgets */}
        <div style={{ marginTop: 'auto', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            onClick={() => navigate('/settings')}
            className="row-hover"
            style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '12px 16px', borderRadius: '12px',
              background: pathname === '/settings' ? 'rgba(79,142,255,0.1)' : 'transparent',
              color: pathname === '/settings' ? '#7ab3ff' : '#7d8fa8',
              border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s'
            }}
          >
            <Settings size={18} style={{ opacity: pathname === '/settings' ? 1 : 0.7 }} />
            <span className="font-mono" style={{ fontSize: '12px', fontWeight: 500, letterSpacing: '0.05em' }}>Settings</span>
          </button>

          <div className="glass-sm" style={{ padding: '16px', borderRadius: '16px' }}>
            <div className="font-mono" style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7d8fa8', marginBottom: '8px' }}>Fleet Spend Today</div>
            <div className="font-display" style={{ fontSize: '20px', fontWeight: 600, color: '#e8eef7' }}>${totalSpend.toFixed(0)}</div>
            <div className="font-mono" style={{ fontSize: '10px', color: '#7d8fa8', marginTop: '2px' }}>of ${totalCap} cap limit</div>
            <div style={{ marginTop: '12px', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '9999px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(totalSpend / totalCap) * 100}%`, background: 'linear-gradient(90deg, #f5a623, #ff4f4f)', borderRadius: '9999px', boxShadow: '0 0 10px rgba(245, 166, 35, 0.5)' }} />
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        
        {/* Top Header */}
        <header style={{
          height: '72px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'linear-gradient(to bottom, rgba(6,10,18,0.9) 0%, rgba(6,10,18,0.4) 100%)',
          backdropFilter: 'blur(20px)',
          zIndex: 30,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
             <StatusBadge status={fleetStatus} label={statusLabel} size="md" />
             <div style={{ height: '24px', width: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }} />
             <span className="font-mono" style={{ fontSize: '11px', color: '#7d8fa8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
               {FLEET_METRICS.activeAgents} / {FLEET_METRICS.totalAgents} Agents Online
             </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            {/* E-Stop */}
            <button
              onMouseDown={startHold} onMouseUp={stopHold} onMouseLeave={stopHold} onTouchStart={startHold} onTouchEnd={stopHold}
              className="glow-stopped"
              style={{
                position: 'relative', overflow: 'hidden',
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 20px', borderRadius: '12px',
                border: '1px solid rgba(255,79,79,0.3)',
                background: 'rgba(255,79,79,0.1)',
                color: '#ff4f4f', cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${holdProgress}%`, background: 'rgba(255,79,79,0.2)', transition: 'none' }} />
              <ShieldAlert size={16} style={{ position: 'relative', zIndex: 1 }} />
              <span className="font-mono" style={{ position: 'relative', zIndex: 1, fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {holding ? `Arming ${Math.round(holdProgress)}%` : 'Emergency Stop'}
              </span>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.08)', transition: 'all 0.2s' }} className="row-hover">
                <Bell size={16} color="#7d8fa8" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingLeft: '16px', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
                <img src="https://i.pravatar.cc/150?u=mchen" alt="User" style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)' }} />
                <span className="font-mono" style={{ fontSize: '12px', color: '#e8eef7' }}>m.chen</span>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="grid-bg" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '32px', position: 'relative' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
