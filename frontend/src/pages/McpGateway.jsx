import React, { useEffect, useState } from 'react';
import { Network, Zap, ShieldCheck, Bot, Banknote, Code, Database, Wallet, CloudCog, ChevronRight, ChevronLeft } from 'lucide-react';

const BRIDGE_LOGS = [
  { color: '#22d07a', title: 'Salesforce Write Success', sub: 'Agent: Support Bot v2.1 • 12ms' },
  { color: '#4f8eff', title: 'Governance Override', sub: 'PII scrubbed from SAP query • 5ms' },
  { color: '#f5a623', title: 'High Latency Alert', sub: 'Amex API endpoint degradation • 840ms' },
  { color: '#22d07a', title: 'Auth Token Rotated', sub: 'System: MCP Gateway Core • 1s ago' },
];

function GraphNode({ style, icon: Icon, iconColor, iconBg, label, sublabel, sublabelColor, glow, size = 'sm' }) {
  const isLarge = size === 'lg';
  return (
    <div style={{ position: 'absolute', ...style, zIndex: 10, transform: 'translate(-50%, -50%)' }}>
      <div className={`glass-strong ${glow ? 'glow-accent' : ''}`} style={{
        padding: isLarge ? '16px' : '12px',
        borderRadius: '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        width: isLarge ? '160px' : '120px',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08) translateY(-4px)'; e.currentTarget.style.boxShadow = glow ? '0 0 32px -4px rgba(79,142,255,0.4)' : '0 12px 24px -8px rgba(0,0,0,0.5)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1) translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
      >
        <div style={{ position: 'relative' }}>
          <div style={{
            width: isLarge ? '56px' : '40px',
            height: isLarge ? '56px' : '40px',
            borderRadius: isLarge ? '16px' : '50%',
            background: iconBg,
            border: `1px solid ${iconColor}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: glow ? `inset 0 0 20px ${iconColor}20` : 'none',
          }}>
            <Icon size={isLarge ? 28 : 20} color={iconColor} />
          </div>
          {!glow && (
            <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '12px', height: '12px', backgroundColor: '#22d07a', borderRadius: '50%', border: `2px solid #060a12`, animation: 'pulse-dot 2s infinite' }} />
          )}
        </div>
        <div style={{ textAlign: 'center' }}>
          <span className="font-display" style={{ display: 'block', fontSize: isLarge ? '13px' : '11px', fontWeight: 600, color: glow ? iconColor : '#e8eef7' }}>{label}</span>
          {sublabel && <span className="font-mono" style={{ display: 'block', fontSize: '9px', color: sublabelColor || '#7d8fa8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '4px' }}>{sublabel}</span>}
        </div>
      </div>
    </div>
  );
}

export default function McpGateway() {
  const [latency, setLatency] = useState(128);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setLatency(120 + Math.floor(Math.random() * 20));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ display: 'flex', height: '100%', margin: '-32px' }}>
      {/* Topology Canvas */}
      <div className="mesh-bg" style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: '600px' }}>

        {/* Animated Background Grid */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '40px 40px', opacity: 0.5, pointerEvents: 'none' }} />

        {/* Header Overlay */}
        <div style={{ position: 'absolute', top: 32, left: 32, zIndex: 20 }}>
          <h2 className="font-display" style={{ fontSize: '24px', fontWeight: 600, margin: '0 0 8px 0', color: '#e8eef7' }}>Network Topology</h2>
          <p className="font-mono" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#7ab3ff', margin: 0 }}>MCP Enterprise Bridge active</p>
        </div>

        {/* SVG network lines */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
          <defs>
            <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4f8eff" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#7ab3ff" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#22d07a" stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id="lineGradIdle" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3d4f6b" stopOpacity="0.2" />
              <stop offset="50%" stopColor="#7d8fa8" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#3d4f6b" stopOpacity="0.2" />
            </linearGradient>
            <filter id="glowLine">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Lines using percentages for responsiveness */}
          {[
            { x1: '15%', y1: '25%', x2: '40%', y2: '50%', active: true },
            { x1: '15%', y1: '50%', x2: '40%', y2: '50%', active: true },
            { x1: '15%', y1: '75%', x2: '40%', y2: '50%', active: false },
            { x1: '40%', y1: '50%', x2: '65%', y2: '50%', active: true, main: true },
            { x1: '65%', y1: '50%', x2: '85%', y2: '25%', active: true },
            { x1: '65%', y1: '50%', x2: '85%', y2: '50%', active: true },
            { x1: '65%', y1: '50%', x2: '85%', y2: '75%', active: false },
          ].map((line, i) => (
            <line key={i} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
              stroke={line.active ? 'url(#lineGrad)' : 'url(#lineGradIdle)'}
              strokeWidth={line.main ? '3' : '2'}
              filter={line.main ? 'url(#glowLine)' : undefined}
              style={line.active ? { strokeDasharray: 12, animation: 'network-dash 20s linear infinite' } : {}}
            />
          ))}
        </svg>

        {/* Nodes (Left) */}
        {[
          { style: { left: '15%', top: '25%' }, icon: Bot, iconColor: '#7ab3ff', iconBg: `rgba(122,179,255,0.1)`, label: 'Support Agent' },
          { style: { left: '15%', top: '50%' }, icon: Banknote, iconColor: '#7ab3ff', iconBg: `rgba(122,179,255,0.1)`, label: 'Finance Bot' },
          { style: { left: '15%', top: '75%' }, icon: Code, iconColor: '#7d8fa8', iconBg: `rgba(125,143,168,0.1)`, label: 'Dev Copilot (Idle)' },
        ].map((node, i) => <GraphNode key={i} {...node} />)}

        {/* Core Nodes (Center) */}
        <GraphNode
          style={{ left: '40%', top: '50%' }}
          icon={ShieldCheck} iconColor="#22d07a" iconBg={`rgba(34,208,122,0.15)`}
          label="Governance" sublabel="Policy Enforcement" sublabelColor="#22d07a"
          glow size="lg"
        />
        <GraphNode
          style={{ left: '65%', top: '50%' }}
          icon={Network} iconColor="#4f8eff" iconBg={`rgba(79,142,255,0.15)`}
          label="MCP Gateway" sublabel="Enterprise Bridge" sublabelColor="#4f8eff"
          glow size="lg"
        />

        {/* Tool nodes (Right) */}
        {[
          { top: '25%', icon: CloudCog, label: 'Salesforce CRM', sub: '99.9% Connected', active: true },
          { top: '50%', icon: Database, label: 'SAP Finance', sub: 'Latency 42ms', active: true },
          { top: '75%', icon: Wallet, label: 'Amex API', sub: 'Offline', active: false },
        ].map((t, i) => (
          <div key={i} style={{ position: 'absolute', left: '85%', top: t.top, zIndex: 10, transform: 'translate(-50%, -50%)' }}>
            <div className="glass" style={{ borderRadius: '16px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', width: '200px', cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05) translateX(-8px)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1) translateX(0)'; e.currentTarget.style.background = ''; }}
            >
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: t.active ? 'rgba(79,142,255,0.1)' : 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${t.active ? 'rgba(79,142,255,0.3)' : 'rgba(255,255,255,0.1)'}`, flexShrink: 0 }}>
                <t.icon size={20} color={t.active ? '#7ab3ff' : '#7d8fa8'} />
              </div>
              <div style={{ minWidth: 0 }}>
                <span className="font-display" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: t.active ? '#e8eef7' : '#7d8fa8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</span>
                <span className="font-mono" style={{ display: 'block', fontSize: '9px', color: t.active ? '#22d07a' : '#f5a623', fontWeight: 600, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.sub}</span>
              </div>
            </div>
          </div>
        ))}

        {/* Legend */}
        <div style={{ position: 'absolute', bottom: '32px', left: '32px', display: 'flex', gap: '16px', zIndex: 20 }}>
          {[{ color: '#22d07a', label: 'Health Nominal' }, { color: '#7ab3ff', label: 'Active Traffic' }].map((l, i) => (
            <div key={i} className="glass" style={{ padding: '8px 16px', borderRadius: '9999px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: l.color, boxShadow: `0 0 8px ${l.color}` }} />
              <span className="font-mono" style={{ fontSize: '9px', fontWeight: 600, color: '#e8eef7', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{l.label}</span>
            </div>
          ))}
        </div>

        {/* Sidebar Toggle Button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="glass-strong glow-accent"
          style={{
            position: 'absolute',
            top: '50%',
            right: '0px',
            transform: 'translateY(-50%)',
            width: '24px',
            height: '64px',
            borderRadius: '8px 0 0 8px',
            border: '1px solid rgba(79,142,255,0.3)',
            borderRight: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 40,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            padding: 0,
            background: 'rgba(6,10,18,0.9)'
          }}
        >
          {sidebarOpen ? <ChevronRight size={18} color="#7ab3ff" /> : <ChevronLeft size={18} color="#7ab3ff" />}
        </button>
      </div>

      {/* Right Side Panel */}
      <aside className="glass-strong" style={{
        width: sidebarOpen ? '360px' : '0px',
        borderLeft: sidebarOpen ? '1px solid rgba(255,255,255,0.08)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        borderRight: 'none',
        borderTop: 'none',
        borderBottom: 'none',
        borderRadius: 0,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        opacity: sidebarOpen ? 1 : 0
      }}>
        <div style={{ width: '360px', display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Header */}
          <div style={{ padding: '32px 24px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <h3 className="font-display" style={{ fontSize: '16px', fontWeight: 600, color: '#e8eef7', margin: '0 0 6px 0' }}>Live Request Metrics</h3>
            <p className="font-mono" style={{ fontSize: '11px', color: '#7d8fa8', margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Real-time throughput for MCP Gateway</p>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '32px' }} className="custom-scrollbar">

            {/* Latency sparkline */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <span className="font-mono" style={{ fontSize: '11px', color: '#7d8fa8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Global Latency</span>
                <span className="font-display gradient-text-blue" style={{ fontSize: '32px', fontWeight: 700, lineHeight: 1 }}>
                  {latency}<span style={{ fontSize: '14px', fontWeight: 500, color: '#7d8fa8', marginLeft: '6px' }}>ms</span>
                </span>
              </div>
              <div style={{ height: '64px', display: 'flex', alignItems: 'flex-end', gap: '4px' }}>
                {[40, 60, 45, 80, 90, 50, 70, 65].map((h, i) => (
                  <div key={i} style={{ flex: 1, height: `${h}%`, background: `linear-gradient(to top, rgba(79,142,255,0.1), rgba(79,142,255,${0.2 + (h / 100) * 0.5}))`, borderRadius: '4px 4px 0 0' }} />
                ))}
              </div>
            </div>

            {/* Throughput */}
            <div className="glass" style={{ borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div className="glow-accent" style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(79,142,255,0.1)', border: '1px solid rgba(79,142,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Zap size={20} color="#7ab3ff" />
                </div>
                <div>
                  <span className="font-mono" style={{ display: 'block', fontSize: '10px', color: '#7d8fa8', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.15em' }}>Throughput</span>
                  <span className="font-display" style={{ display: 'block', fontSize: '16px', fontWeight: 600, color: '#e8eef7', marginTop: '4px' }}>2.4k req/sec</span>
                </div>
              </div>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '9999px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '65%', background: 'linear-gradient(90deg, #4f8eff, #7ab3ff)', borderRadius: '9999px', boxShadow: '0 0 12px rgba(79,142,255,0.5)' }} />
              </div>
            </div>

            {/* Bridge Logs */}
            <div>
              <h4 className="font-mono" style={{ fontSize: '10px', color: '#7d8fa8', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.15em', marginBottom: '20px' }}>Bridge Logs</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {BRIDGE_LOGS.map((log, i) => (
                  <div key={i} style={{ display: 'flex', gap: '16px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: log.color, boxShadow: `0 0 8px ${log.color}`, marginTop: '4px', flexShrink: 0 }} />
                    <div>
                      <p className="font-display" style={{ fontSize: '13px', fontWeight: 500, color: '#e8eef7', margin: '0 0 4px 0' }}>{log.title}</p>
                      <p className="font-mono" style={{ fontSize: '10px', color: '#7d8fa8', margin: 0 }}>{log.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Active Sessions Footer */}
          <div style={{ padding: '24px', borderTop: `1px solid rgba(255,255,255,0.06)`, background: 'rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <span className="font-mono" style={{ fontSize: '11px', fontWeight: 600, color: '#7d8fa8', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Active Agents</span>
              <span className="font-mono" style={{ padding: '4px 12px', borderRadius: '9999px', background: 'rgba(79,142,255,0.1)', color: '#7ab3ff', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em' }}>14 Active</span>
            </div>
            <div style={{ display: 'flex' }}>
              {[
                'https://lh3.googleusercontent.com/aida-public/AB6AXuC1Nq8cf9WlpwWXHJHpW82Nt85shb-AJLwS5ZL1_qX1MFkbOwFOxiUrZXDHnQr87VeV8GVxqS2toGMLiwhaHDhrfKy4VZY2DYzphbxTvt8hisg1mmUYAvlxKpi0zKouqCvZGx-9iWbZFiIOVWFDGRdN2cgnF6a4Ygb6g5GNKmESZtK-4XDmce7bRa5bVzzkqRrgn7PVpKvYxJjIrI5DXm0zIsyauUzPdbPl-Zka69V2nMbjZj7ieK2TSHBCJd2SZdtzya1Bbe-BN4gg',
                'https://lh3.googleusercontent.com/aida-public/AB6AXuDiqO1Ru1GD3XqQamEL3wEXIqAjNj5SWX6ouMzuUEt6vnbWVHh7hfhO94KJM0g-jwb1xARuVizmylR2_T5k9s-OvW-Ev6aY8Rw0qL07sU1MgoEUIiJRA4WEbRu12syqFER-0Miv7iFoYm92kRO8YVMfS7Wr3gB-s0C3C2-kSCodg0AvwJifJFmIc11zsqMCiSbG-17xaovRt1wyyxAGTIADOW6hQkzLOvXub1tQq44SXv9u7lNgqSkCT-UB66H2_hH0zJ8yVwMoDpIz',
                'https://lh3.googleusercontent.com/aida-public/AB6AXuAEWl_FY43ra-Gii35P8Ow5d-CYLoVQCOeb1VKql8kD5LE8QM9ksDT2Uo_urbQWuwXJ0XDdt9ydiIsjVzSFZ0mHwU2swoehBI-a_f4PKl_DnqV6Q8zkVj8c-iBINPABigzvYqJbQhcmva1wZ1k-Ndq82F1z3iS2FDeTWBJj1jx9185WM7u08T6gVDb2tudZg31Xa8RyjAu-zYzkRuWfr0eg6S76IOCv39A-F-jc15yC5J5wU6EOvR5EqC8jGAmaR80nRcDbAz-xxTnH',
              ].map((src, i) => (
                <img key={i} src={src} alt={`Agent ${i + 1}`} style={{ width: '40px', height: '40px', borderRadius: '50%', border: `2px solid #060a12`, marginLeft: i > 0 ? '-12px' : 0, objectFit: 'cover', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', position: 'relative', zIndex: 3 - i }} />
              ))}
              <div className="font-mono" style={{ width: '40px', height: '40px', borderRadius: '50%', border: `2px solid #060a12`, background: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: '#7d8fa8', marginLeft: '-12px', zIndex: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                +11
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
