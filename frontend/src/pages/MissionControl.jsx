import React, { useEffect } from 'react';

const C = {
  surface:    '#11131b',
  surfaceLow: '#191b23',
  surfaceCont:'#1d1f27',
  surfaceHigh:'#282a32',
  surfaceHighest:'#32343d',
  primary:    '#b4c5ff',
  primaryCont:'#2563eb',
  onPrimary:  '#eeefff',
  secondary:  '#4cd7f6',
  secondaryCont:'#03b5d3',
  tertiary:   '#d2bbff',
  tertiaryCont:'#8343f4',
  error:      '#ffb4ab',
  errorCont:  '#93000a',
  onErrorCont:'#ffdad6',
  onSurface:  '#e1e2ed',
  onSurfaceV: '#c3c6d7',
  outline:    '#8d90a0',
  outlineV:   '#434655',
  emerald:    '#10b981',
  amber:      '#f59e0b',
};

const glass = {
  background: 'rgba(29,31,39,0.5)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '1px solid rgba(141,144,160,0.12)',
};

function KpiCard({ icon, iconColor, tag, tagBg, tagColor, value, label, hoverColor }) {
  return (
    <div
      style={{ ...glass, borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '100px', cursor: 'default', transition: 'border-color 0.2s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = hoverColor || 'rgba(141,144,160,0.3)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(141,144,160,0.12)'}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <span className="material-symbols-outlined" style={{ color: iconColor, fontSize: '22px' }}>{icon}</span>
        {tag && (
          <span style={{ fontSize: '10px', fontWeight: 700, color: tagColor, backgroundColor: tagBg, padding: '2px 6px', borderRadius: '4px', letterSpacing: '0.05em', fontFamily: 'Geist, sans-serif' }}>
            {tag}
          </span>
        )}
      </div>
      <div>
        <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'Geist, sans-serif', color: C.onSurface, lineHeight: 1.2 }}>{value}</div>
        <div style={{ fontSize: '10px', color: C.onSurfaceV, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '4px' }}>{label}</div>
      </div>
    </div>
  );
}

export default function MissionControl() {
  useEffect(() => {
    const counters = document.querySelectorAll('[data-counter]');
    counters.forEach(counter => {
      const target = +counter.getAttribute('data-counter');
      const speed = 100;
      const increment = target / speed;
      let current = 0;
      const animate = () => {
        current = Math.min(current + increment, target);
        counter.textContent = Math.ceil(current);
        if (current < target) setTimeout(animate, 20);
      };
      animate();
    });
  }, []);

  return (
    <div style={{ padding: '32px', maxWidth: '1600px', margin: '0 auto' }}>
      {/* Welcome Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '32px', fontWeight: 700, fontFamily: 'Geist, sans-serif', color: C.onSurface, letterSpacing: '-0.01em', margin: 0 }}>
            Mission Control
          </h1>
          <p style={{ color: C.onSurfaceV, fontSize: '16px', marginTop: '6px' }}>
            Real-time governance and operational oversight for Guardian AI cluster.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '6px 12px',
            backgroundColor: 'rgba(3,181,211,0.1)',
            border: '1px solid rgba(3,181,211,0.3)',
            borderRadius: '9999px', color: C.secondary
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px', animation: 'pulse 2s infinite' }}>radio_button_checked</span>
            <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'Geist, sans-serif' }}>Live Monitoring</span>
          </div>
          <button style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 16px',
            backgroundColor: C.surfaceHigh,
            border: '1px solid rgba(67,70,85,0.3)',
            borderRadius: '8px', color: C.onSurface, cursor: 'pointer',
            fontSize: '14px', fontFamily: 'Geist, sans-serif'
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>calendar_today</span>
            Last 24 Hours
          </button>
        </div>
      </div>

      {/* KPI Grid - 7 columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '16px', marginBottom: '32px' }}>
        <KpiCard icon="speed" iconColor={C.primary} tag="GO GATEWAY" tagBg="rgba(180,197,255,0.1)" tagColor={C.primary} value="4.2ms" label="Gateway Latency" hoverColor="rgba(180,197,255,0.5)" />
        <KpiCard icon="timer" iconColor={C.secondary} tag="OPA ENGINE" tagBg="rgba(76,215,246,0.1)" tagColor={C.secondary} value="12.8ms" label="Decision Time" hoverColor="rgba(76,215,246,0.5)" />
        <KpiCard icon="cancel" iconColor={C.error} tag="REDIS CACHE" tagBg="rgba(255,180,171,0.1)" tagColor={C.error} value={<span data-counter="12">0</span>} label="Active Revocations" hoverColor="rgba(255,180,171,0.5)" />
        <KpiCard icon="verified_user" iconColor={C.tertiary} tag="STABILITY" tagBg="rgba(210,187,255,0.1)" tagColor={C.tertiary} value="94.2%" label="Trust Index" hoverColor="rgba(210,187,255,0.5)" />
        {/* Risk card */}
        <div style={{ ...glass, borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '100px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <span className="material-symbols-outlined" style={{ color: '#10b981', fontSize: '22px' }}>shield_with_heart</span>
            <div style={{ height: '6px', width: '48px', backgroundColor: C.outlineV, borderRadius: '9999px', overflow: 'hidden', marginTop: '8px' }}>
              <div style={{ height: '100%', width: '25%', backgroundColor: '#10b981' }} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'Geist, sans-serif', color: '#10b981' }}>Low</div>
            <div style={{ fontSize: '10px', color: C.onSurfaceV, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '4px' }}>Risk Level</div>
          </div>
        </div>
        <KpiCard icon="account_balance_wallet" iconColor={C.primary} tag="ENFORCED" tagBg="rgba(180,197,255,0.1)" tagColor={C.primary} value="$8.2k / $10k" label="Spend Counters" hoverColor="rgba(180,197,255,0.5)" />
        <KpiCard icon="payments" iconColor={C.secondary} tag="TOKEN BURN" tagBg="rgba(76,215,246,0.1)" tagColor={C.secondary} value="$12.4k" label="Daily Cost" />
      </div>

      {/* Main dashboard grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Governance Trend Chart */}
          <div style={{ ...glass, borderRadius: '16px', padding: '24px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'Geist, sans-serif', color: C.onSurface, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <span className="material-symbols-outlined" style={{ color: C.primary, fontSize: '18px' }}>trending_up</span>
                  Governance Trend (Hash-Linked)
                </h3>
                <p style={{ fontSize: '11px', color: C.onSurfaceV, marginTop: '4px' }}>Decision integrity scores verified via PostgreSQL Audit layer</p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[['#b4c5ff','Trust'],['#4cd7f6','Risk']].map(([color,label]) => (
                  <div key={label} style={{ display:'flex',alignItems:'center',gap:'6px',padding:'4px 12px',backgroundColor:C.surfaceLow,borderRadius:'6px',border:`1px solid ${C.outlineV}` }}>
                    <div style={{ width:'8px',height:'8px',borderRadius:'50%',backgroundColor:color }} />
                    <span style={{ fontSize:'10px',fontWeight:700,color:C.onSurfaceV,textTransform:'uppercase',fontFamily:'Geist,sans-serif' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ height: '240px', position: 'relative', width: '100%' }}>
              <svg style={{ width: '100%', height: '100%' }} preserveAspectRatio="none" viewBox="0 0 1000 200">
                <defs>
                  <linearGradient id="chartGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#b4c5ff" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#b4c5ff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[50,100,150].map(y => (
                  <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="#334155" strokeDasharray="4" strokeWidth="1" />
                ))}
                <path d="M0,150 L100,140 L200,145 L300,120 L400,130 L500,100 L600,110 L700,80 L800,90 L900,70 L1000,75" fill="none" stroke="#b4c5ff" strokeLinecap="round" strokeWidth="3" />
                <path d="M0,150 L100,140 L200,145 L300,120 L400,130 L500,100 L600,110 L700,80 L800,90 L900,70 L1000,75 L1000,200 L0,200 Z" fill="url(#chartGrad)" />
                <path d="M0,50 L150,60 L300,45 L450,55 L600,40 L750,50 L900,35 L1000,40" fill="none" stroke="#4cd7f6" strokeDasharray="6" strokeLinecap="round" strokeWidth="2" />
              </svg>
              <div style={{ position: 'absolute', bottom: 0, width: '100%', display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: C.outline, fontWeight: 700, paddingTop: '16px' }}>
                {['08:00','10:00','12:00','14:00','16:00','18:00','20:00'].map(t => <span key={t}>{t}</span>)}
              </div>
            </div>
          </div>

          {/* Bottom row: heatmap + infra */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {/* Risk Heatmap */}
            <div style={{ ...glass, borderRadius: '16px', padding: '24px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'Geist, sans-serif', color: C.onSurface, display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 24px 0' }}>
                <span className="material-symbols-outlined" style={{ color: C.secondary, fontSize: '18px' }}>grid_view</span>
                Global Risk Distribution
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '8px', height: '160px' }}>
                {[
                  'rgba(16,185,129,0.2)','rgba(16,185,129,0.4)','rgba(16,185,129,0.1)','rgba(245,158,11,0.4)','rgba(16,185,129,0.3)',
                  'rgba(16,185,129,0.5)','rgba(16,185,129,0.1)','rgba(239,68,68,0.6)','rgba(16,185,129,0.2)','rgba(16,185,129,0.4)',
                  'rgba(16,185,129,0.1)','rgba(245,158,11,0.2)','rgba(16,185,129,0.3)','rgba(16,185,129,0.1)','rgba(16,185,129,0.2)',
                ].map((bg, i) => (
                  <div key={i} style={{ backgroundColor: bg, border: `1px solid ${bg.includes('239') ? 'rgba(239,68,68,0.3)' : bg.includes('245') ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}`, borderRadius: '4px', animation: bg.includes('239') ? 'pulse 2s infinite' : 'none' }} />
                ))}
              </div>
              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: C.outline, fontWeight: 700, textTransform: 'uppercase' }}>Critical Clusters</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '10px', color: C.outline, fontWeight: 700, textTransform: 'uppercase' }}>Risk:</span>
                  <div style={{ height: '8px', width: '96px', borderRadius: '9999px', background: 'linear-gradient(90deg,#10b981 0%,#f59e0b 50%,#ef4444 100%)' }} />
                </div>
              </div>
            </div>

            {/* Core Infra Integrity */}
            <div style={{ ...glass, borderRadius: '16px', padding: '24px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'Geist, sans-serif', color: C.onSurface, display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 24px 0' }}>
                <span className="material-symbols-outlined" style={{ color: C.primary, fontSize: '18px' }}>settings_input_component</span>
                Core Infra Integrity
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {[
                  'Gateway (Go) MCP',
                  'OPA (Open Policy Agent)',
                  'Redis (Live Cache)',
                  'PostgreSQL (Audit Store)',
                ].map(name => (
                  <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', color: C.onSurfaceV }}>{name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#10b981' }}>Operational</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Security Alerts */}
          <div style={{ ...glass, borderRadius: '16px', padding: '20px', borderLeft: '4px solid #ffb4ab' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'Geist, sans-serif', color: C.onSurface, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <span className="material-symbols-outlined" style={{ color: C.error, fontSize: '18px' }}>warning</span>
                Security Alerts
              </h3>
              <span style={{ fontSize: '10px', fontWeight: 700, color: C.error, backgroundColor: 'rgba(255,180,171,0.1)', padding: '2px 8px', borderRadius: '4px' }}>2 NEW</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[{
                icon:'policy', color:C.error, bg:'rgba(147,0,10,0.05)', border:'rgba(255,180,171,0.2)',
                title:'Unauthorized Tool Attempt',
                desc:<>Agent <code style={{fontSize:'11px',backgroundColor:'rgba(255,255,255,0.05)',padding:'1px 4px',borderRadius:'3px'}}>Fin-GPT-04</code> tried to call <code style={{fontSize:'11px',backgroundColor:'rgba(255,255,255,0.05)',padding:'1px 4px',borderRadius:'3px'}}>exec_shell</code>. Blocked by OPA Engine.</>,
                time:'14:23:01 UTC'
              },{
                icon:'info', color:'#f59e0b', bg:'rgba(245,158,11,0.05)', border:'rgba(245,158,11,0.2)',
                title:'Real-time Revocation',
                desc:<>Spending cap reached for <code style={{fontSize:'11px',backgroundColor:'rgba(255,255,255,0.05)',padding:'1px 4px',borderRadius:'3px'}}>Mktg-Agent-01</code>. Access revoked in Redis cache.</>,
                time:'13:45:12 UTC'
              }].map((alert, i) => (
                <div key={i} style={{ padding: '12px', backgroundColor: alert.bg, border: `1px solid ${alert.border}`, borderRadius: '8px', display: 'flex', gap: '12px' }}>
                  <span className="material-symbols-outlined" style={{ color: alert.color, fontSize: '20px', marginTop: '2px' }}>{alert.icon}</span>
                  <div>
                    <p style={{ fontSize: '14px', fontWeight: 700, color: C.onSurface, margin: 0 }}>{alert.title}</p>
                    <p style={{ fontSize: '12px', color: C.onSurfaceV, marginTop: '4px' }}>{alert.desc}</p>
                    <p style={{ fontSize: '10px', color: C.outline, marginTop: '8px', fontFamily: 'monospace' }}>{alert.time}</p>
                  </div>
                </div>
              ))}
            </div>
            <button style={{ width: '100%', marginTop: '16px', fontSize: '11px', fontWeight: 700, color: C.primary, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '8px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'Geist, sans-serif' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(180,197,255,0.05)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              View All Alerts
            </button>
          </div>

          {/* Audit Stream */}
          <div style={{ ...glass, borderRadius: '16px', padding: '20px', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'Geist, sans-serif', color: C.onSurface, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <span className="material-symbols-outlined" style={{ color: C.secondary, fontSize: '18px' }}>history</span>
                Action Logs (Audit Stream)
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                <span style={{ fontSize: '10px', fontWeight: 700, color: C.outline, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Streaming Live</span>
              </div>
            </div>

            <div style={{ position: 'relative', overflowY: 'auto', maxHeight: '400px', paddingRight: '8px' }} className="custom-scrollbar">
              <div style={{ position: 'absolute', left: '13px', top: '8px', bottom: '8px', width: '1px', backgroundColor: C.outlineV }} />

              {[{
                icon:'bolt', hoverColor:C.primary, label:'Agent: Search-Bot-02', time:'2m ago',
                content:<><span style={{color:C.primary,fontWeight:600}}>Gateway MCP:</span> Google Search API call initiated via JWT-secured HTTPS.</>,
                tags:[{text:'GOVERNED',bg:'rgba(16,185,129,0.1)',color:'#10b981'},{text:'LATENCY: 4.2ms',bg:'rgba(67,70,85,0.2)',color:C.outline}]
              },{
                icon:'gavel', hoverColor:C.secondary, label:'OPA Decision Engine', time:'12m ago',
                content:<><span style={{color:C.primary,fontWeight:600}}>Policy Decision:</span> Search API authorized. <span style={{color:C.outline,fontStyle:'italic'}}>Hash-Linked Audit Decision: PostgreSQL:0x7f2a...9b1</span></>,
                tags:[]
              },{
                icon:'database', hoverColor:C.tertiary, label:'Redis: Live State', time:'24m ago',
                content:<><span style={{color:C.secondary,fontWeight:600}}>State Sync:</span> Updated Session State & Spend Counters for <code style={{fontSize:'10px'}}>HR-Assistant</code>. <span style={{color:C.outline,fontStyle:'italic'}}>Audit Hash: 0x4d1e...2c8</span></>,
                tags:[]
              },{
                icon:'history_edu', hoverColor:null, label:'PostgreSQL Audit', time:'1h ago',
                content:'Appended 1,420 hash-linked audit decisions to persistent config store.',
                tags:[]
              }].map((item, i) => (
                <div key={i} style={{ position: 'relative', paddingLeft: '32px', marginBottom: '24px' }}>
                  <div style={{ position: 'absolute', left: 0, top: '4px', width: '28px', height: '28px', borderRadius: '50%', backgroundColor: C.surface, border: `1px solid ${C.outlineV}`, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: C.onSurfaceV }}>{item.icon}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: C.onSurface }}>{item.label}</span>
                    <span style={{ fontSize: '10px', color: C.outline, fontFamily: 'monospace' }}>{item.time}</span>
                  </div>
                  <div style={{ marginTop: '8px', padding: '10px', backgroundColor: C.surfaceLow, border: `1px solid rgba(67,70,85,0.2)`, borderRadius: '8px' }}>
                    <p style={{ fontSize: '11px', color: C.onSurfaceV, lineHeight: '1.6', margin: 0 }}>{item.content}</p>
                    {item.tags.length > 0 && (
                      <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                        {item.tags.map((tag, j) => (
                          <span key={j} style={{ fontSize: '9px', padding: '2px 6px', backgroundColor: tag.bg, color: tag.color, fontWeight: 700, borderRadius: '4px', fontFamily: 'Geist, sans-serif' }}>{tag.text}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
