import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, TrendingUp, Zap, TriangleAlert } from 'lucide-react';
import {
  FLEET_METRICS, MOCK_AGENTS, MOCK_SPEND_BY_CLASS,
  MOCK_ACTIVITY, generateThroughputData, generateSpendData
} from '@/services/mockData';
import { StatusBadge } from '@/components/layout/Layout';
import { FleetRadar } from '@/components/FleetRadar';

const S = {
  bg:       '#0d1117',
  panel:    '#161b22',
  border:   'rgba(255,255,255,0.06)',
  text:     '#e6edf3',
  muted:    '#8b949e',
  accent:   '#4c8dff',
  healthy:  '#3ddc84',
  caution:  '#e3b341',
  stopped:  '#f85149',
};

const glass = { background: 'rgba(255,255,255,0.03)', border: `1px solid ${S.border}`, borderRadius: '16px' };
const mono  = { fontFamily: 'JetBrains Mono, monospace' };

function KpiCard({ label, value, sub, accent, glow }) {
  return (
    <div style={{ ...glass, position: 'relative', display: 'flex', flexDirection: 'column', gap: '6px', padding: '20px', overflow: 'hidden', boxShadow: glow ? `0 0 24px -4px ${glow}25` : 'none' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '3px', borderRadius: '16px 0 0 16px', backgroundColor: accent }} />
      <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>{label}</span>
      <span style={{ ...mono, fontSize: '24px', color: S.text }}>{value}</span>
      {sub && <span style={{ ...mono, fontSize: '11px', color: S.muted }}>{sub}</span>}
    </div>
  );
}

function StatBox({ icon: Icon, label, value, color }) {
  return (
    <div style={{ ...glass, padding: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Icon size={12} color={color} />
        <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>{label}</span>
      </div>
      <span style={{ ...mono, fontSize: '20px', color }}>{value}</span>
    </div>
  );
}

const typeStyle = {
  allow:  { color: '#3ddc84', label: 'ALLOW' },
  deny:   { color: '#f85149', label: 'DENY' },
  revoke: { color: '#e3b341', label: 'REVOKE' },
};

export default function CommandCenter() {
  const navigate = useNavigate();
  const [throughput, setThroughput] = useState(() => generateThroughputData());
  const [spend]     = useState(() => generateSpendData());
  const m = FLEET_METRICS;

  useEffect(() => {
    const interval = setInterval(() => {
      setThroughput(prev => {
        const next = [...prev.slice(1), {
          t: new Date().toLocaleTimeString(),
          allow: Math.floor(Math.random() * 80 + 20),
          deny: Math.floor(Math.random() * 10),
        }];
        return next;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const statusLabel = m.fleetStatus === 'healthy' ? 'Healthy' : m.fleetStatus === 'caution' ? 'Caution' : 'Stopped';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <KpiCard
          label="Agents Active"
          value={`${m.activeAgents} / ${m.totalAgents}`}
          sub={`${m.revokedAgents} revoked · ${m.killedAgents} killed`}
          accent={S.healthy} glow={S.healthy}
        />
        <KpiCard
          label="Spend Today"
          value={`$${m.totalSpend.toFixed(0)}`}
          sub={`of $${m.totalCap} total cap`}
          accent={S.accent} glow={S.accent}
        />
        <KpiCard
          label="Denials (1h)"
          value={m.denials}
          sub="actions blocked by policy"
          accent={S.accent}
        />
        <div style={{ ...glass, position: 'relative', overflow: 'hidden', padding: '20px', display: 'flex', flexDirection: 'column', gap: '6px', boxShadow: `0 0 24px -4px ${S.healthy}25` }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '3px', borderRadius: '16px 0 0 16px', backgroundColor: S.healthy }} />
          <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>Fleet Status</span>
          <StatusBadge status={m.fleetStatus} label={statusLabel} size="md" />
          <span style={{ ...mono, fontSize: '11px', color: S.muted }}>all systems nominal</span>
        </div>
      </div>

      {/* Middle row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
        {/* Charts */}
        <div style={{ ...glass, padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'rgba(76,141,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Activity size={16} color={S.accent} />
              </div>
              <div>
                <h3 style={{ ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, margin: 0 }}>Fleet Throughput</h3>
                <p style={{ ...mono, fontSize: '10px', color: 'rgba(139,148,158,0.6)', margin: 0 }}>Actions per 10s — last 5 minutes</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {[['#3ddc84','Allow'],['#f85149','Deny']].map(([c,l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: c, display: 'inline-block' }} />
                  <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted }}>{l}</span>
                </div>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={throughput} margin={{ top: 0, right: 0, bottom: 0, left: -32 }}>
              <defs>
                <linearGradient id="gradAllow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3ddc84" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3ddc84" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradDeny" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f85149" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f85149" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fill: '#8b949e' }} tickLine={false} axisLine={false} interval={4} />
              <YAxis tick={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fill: '#8b949e' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#161b22', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#e6edf3' }} />
              <Area type="monotone" dataKey="allow" stroke="#3ddc84" strokeWidth={1.5} fill="url(#gradAllow)" dot={false} />
              <Area type="monotone" dataKey="deny" stroke="#f85149" strokeWidth={1.5} fill="url(#gradDeny)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>

          {/* Spend Trajectory */}
          <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TrendingUp size={14} color={S.muted} />
                <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>Spend Trajectory (24h)</span>
              </div>
              <span style={{ ...mono, fontSize: '12px', color: S.text }}>${m.totalSpend.toFixed(0)} <span style={{ color: S.muted }}>/ ${m.totalCap}</span></span>
            </div>
            <ResponsiveContainer width="100%" height={100}>
              <AreaChart data={spend} margin={{ top: 0, right: 0, bottom: 0, left: -32 }}>
                <defs>
                  <linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4c8dff" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#4c8dff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" tick={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fill: '#8b949e' }} tickLine={false} axisLine={false} interval={4} />
                <YAxis hide />
                <Tooltip contentStyle={{ background: '#161b22', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }} formatter={v => [`$${v}`, 'Spend']} />
                <Area type="monotone" dataKey="spend" stroke="#4c8dff" strokeWidth={1.5} fill="url(#gradSpend)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: stat boxes + agent grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <StatBox icon={Zap} label="Active" value={m.activeAgents} color={S.healthy} />
            <StatBox icon={TriangleAlert} label="Revoked" value={m.revokedAgents} color={S.caution} />
            <div style={{ ...glass, padding: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>Killed</span>
              <span style={{ ...mono, fontSize: '20px', color: S.stopped }}>{m.killedAgents}</span>
            </div>
            <div style={{ ...glass, padding: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>Denies</span>
              <span style={{ ...mono, fontSize: '20px', color: S.text }}>{m.denials}</span>
            </div>
          </div>

          {/* Fleet Radar */}
          <div style={{ ...glass, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, margin: 0 }}>Fleet Radar</h3>
              <button onClick={() => navigate('/agents')} style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.accent, background: 'none', border: 'none', cursor: 'pointer' }}>View all →</button>
            </div>
            <div style={{ padding: '12px', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at center, rgba(76,141,255,0.05) 0%, transparent 70%)' }}>
              <FleetRadar 
                instances={MOCK_AGENTS.map((a, i) => ({ id: a.id, class: ['Support', 'Finance', 'Internal'][i % 3], status: a.status }))} 
                classes={[{id: 'Support', name: 'SUPPORT'}, {id: 'Finance', name: 'FINANCE'}, {id: 'Internal', name: 'INTERNAL'}]} 
                size={260} 
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        {/* Alerts */}
        <div style={{ ...glass, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, margin: 0 }}>Recent Alerts</h3>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: '380px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {MOCK_ACTIVITY.filter(a => a.type !== 'allow').map(a => (
              <div key={a.id} style={{ padding: '10px 12px', borderRadius: '8px', background: a.type === 'deny' ? 'rgba(248,81,73,0.06)' : 'rgba(227,179,65,0.06)', border: `1px solid ${a.type === 'deny' ? 'rgba(248,81,73,0.2)' : 'rgba(227,179,65,0.2)'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ ...mono, fontSize: '10px', fontWeight: 600, color: typeStyle[a.type]?.color }}>{typeStyle[a.type]?.label}</span>
                  <span style={{ ...mono, fontSize: '10px', color: S.muted }}>{a.ts}</span>
                </div>
                <p style={{ ...mono, fontSize: '11px', color: S.text, margin: 0 }}>{a.event}</p>
                <p style={{ ...mono, fontSize: '10px', color: S.muted, margin: '4px 0 0 0' }}>{a.agent}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Spend by Class */}
        <div style={{ ...glass, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, margin: 0 }}>Spend by Class</h3>
            <button onClick={() => navigate('/policies')} style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.accent, background: 'none', border: 'none', cursor: 'pointer' }}>Manage policies</button>
          </div>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {MOCK_SPEND_BY_CLASS.map(item => (
              <div key={item.class}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ ...mono, fontSize: '11px', color: S.text }}>{item.class}</span>
                  <span style={{ ...mono, fontSize: '11px', color: S.muted }}>${item.spend.toFixed(0)} / ${item.cap}</span>
                </div>
                <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '9999px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(item.spend / item.cap) * 100}%`, backgroundColor: item.color, borderRadius: '9999px' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div style={{ ...glass, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, margin: 0 }}>Recent Activity</h3>
            <button onClick={() => navigate('/audit-log')} style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.accent, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Audit log →
            </button>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: '380px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {MOCK_ACTIVITY.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', alignItems: 'flex-start' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: typeStyle[a.type]?.color, marginTop: '3px', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ ...mono, fontSize: '11px', color: S.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.event}</p>
                  <p style={{ ...mono, fontSize: '10px', color: S.muted, margin: '2px 0 0 0' }}>{a.agent} · {a.ts}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
