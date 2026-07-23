import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { agentService } from '@/services/agent.service';

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
  tertiary:   '#d2bbff',
  error:      '#ffb4ab',
  errorCont:  '#93000a',
  onErrorCont:'#ffdad6',
  onSurface:  '#e1e2ed',
  onSurfaceV: '#c3c6d7',
  outline:    '#8d90a0',
  outlineV:   '#434655',
};

const glass = {
  background: 'rgba(29,31,39,0.7)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '1px solid rgba(141,144,160,0.1)',
};

const deptColor = { FINANCE: C.primary, CX: C.tertiary, FRAUD: C.error };
const deptIcon = { FINANCE: 'smart_toy', CX: 'support_agent', FRAUD: 'shield' };

export default function AgentManagement() {
  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: agentService.getAgents,
  });
  const [hoveredRow, setHoveredRow] = useState(null);

  return (
    <div style={{ padding: '32px', maxWidth: '1600px', margin: '0 auto' }}>
      {/* Architecture Path */}
      <div style={{ ...glass, borderRadius: '12px', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', overflowX: 'auto', marginBottom: '32px', gap: '16px', whiteSpace: 'nowrap', boxShadow: 'inset 0 1px 1px 0 rgba(255,255,255,0.05)' }}>
        {[
          { bg: C.surfaceHighest, border: true, icon: 'smart_toy', iconColor: C.primary, label: 'SOURCE', name: 'Active Agent' },
          null,
          { bg: C.primaryCont, iconColor: C.onPrimary, icon: 'hub', label: 'GATEWAY', name: 'Go Proxy (JWT via HTTPS)', shadow: '0 4px 15px rgba(37,99,235,0.2)' },
          null,
          { bg: C.surfaceHighest, iconColor: '#03b5d3', icon: 'gavel', label: 'AUTHZ', name: 'OPA Policy Engine' },
          null,
          { bg: C.surfaceHighest, border: true, borderColor: 'rgba(16,185,129,0.5)', icon: 'account_balance', iconColor: '#10b981', label: 'DESTINATION', name: 'Bank Core Services' },
        ].map((item, i) => item === null ? (
          <span key={i} className="material-symbols-outlined" style={{ color: C.outline, fontSize: '20px' }}>arrow_forward</span>
        ) : (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 'fit-content' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: item.bg, border: item.border ? `2px solid ${item.borderColor || C.outlineV}` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: item.shadow || 'none' }}>
              <span className="material-symbols-outlined" style={{ color: item.iconColor, fontSize: '20px' }}>{item.icon}</span>
            </div>
            <div>
              <p style={{ fontSize: '10px', fontWeight: 700, color: C.outlineV, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{item.label}</p>
              <p style={{ fontSize: '12px', fontWeight: 600, color: C.onSurface, margin: 0 }}>{item.name}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Agent Table */}
      <div style={{ ...glass, borderRadius: '12px', overflow: 'hidden', boxShadow: 'inset 0 1px 1px 0 rgba(255,255,255,0.05)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1100px' }}>
            <thead>
              <tr style={{ backgroundColor: 'rgba(40,42,50,0.5)', borderBottom: `1px solid rgba(67,70,85,0.3)` }}>
                {['Agent Identity', 'Dept/Model', 'OPA Authorization', 'Spend Counter', 'Connection', 'Risk', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '16px 24px', textAlign: h === 'Actions' ? 'right' : 'left', fontSize: '11px', fontWeight: 700, color: C.outlineV, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'Geist, sans-serif', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '48px', textAlign: 'center', color: C.onSurfaceV, fontSize: '14px' }}>
                    Loading agents...
                  </td>
                </tr>
              ) : agents.map((agent) => {
                const isHovered = hoveredRow === agent.id;
                const spendPct = agent.spendCap > 0 ? (agent.currentSpend / agent.spendCap) * 100 : 0;
                const barColor = spendPct > 80 ? '#ef4444' : spendPct > 60 ? '#f59e0b' : '#10b981';
                const statusStyles = {
                  Active: { bg: 'rgba(16,185,129,0.1)', color: '#10b981' },
                  Pending: { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b' },
                  Revoked: { bg: 'rgba(255,180,171,0.1)', color: C.error },
                };
                const st = statusStyles[agent.status] || statusStyles.Active;

                return (
                  <tr key={agent.id}
                    onMouseEnter={() => setHoveredRow(agent.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    style={{ borderBottom: `1px solid rgba(67,70,85,0.1)`, backgroundColor: isHovered ? 'rgba(255,255,255,0.03)' : 'transparent', transition: 'background-color 0.15s' }}
                  >
                    {/* Agent Identity */}
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '6px', backgroundColor: C.surfaceHighest, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span className="material-symbols-outlined" style={{ color: deptColor[agent.department], fontSize: '18px' }}>{deptIcon[agent.department]}</span>
                        </div>
                        <div>
                          <p style={{ fontSize: '14px', fontWeight: 600, color: C.onSurface, margin: 0 }}>{agent.name}</p>
                          <p style={{ fontSize: '10px', color: C.outline, fontFamily: 'monospace', margin: 0 }}>{agent.id}</p>
                        </div>
                      </div>
                    </td>
                    {/* Dept */}
                    <td style={{ padding: '16px 24px' }}>
                      <p style={{ fontSize: '11px', fontWeight: 700, color: deptColor[agent.department], margin: 0 }}>{agent.department}</p>
                      <p style={{ fontSize: '11px', color: C.outline, margin: 0 }}>{agent.model}</p>
                    </td>
                    {/* Auth */}
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="material-symbols-outlined" style={{ color: agent.authorization === 'Authorized' ? '#10b981' : '#f59e0b', fontSize: '16px' }}>
                          {agent.authorization === 'Authorized' ? 'verified' : 'hourglass_empty'}
                        </span>
                        <span style={{ fontSize: '12px', fontWeight: 500, color: agent.authorization === 'Authorized' ? '#10b981' : '#f59e0b' }}>{agent.authorization}</span>
                      </div>
                    </td>
                    {/* Spend */}
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ width: '128px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <span style={{ fontSize: '10px', color: C.onSurface }}>${agent.currentSpend.toFixed(2)}</span>
                          <span style={{ fontSize: '10px', color: C.outline }}>{agent.spendCap > 0 ? `$${agent.spendCap} Cap` : 'Locked'}</span>
                        </div>
                        <div style={{ height: '6px', backgroundColor: C.surfaceHighest, borderRadius: '9999px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${spendPct}%`, backgroundColor: barColor, borderRadius: '9999px' }} />
                        </div>
                      </div>
                    </td>
                    {/* Connection */}
                    <td style={{ padding: '16px 24px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: agent.connection.includes('JWT') ? C.primary : C.outline, backgroundColor: agent.connection.includes('JWT') ? 'rgba(180,197,255,0.1)' : 'rgba(67,70,85,0.2)', padding: '2px 8px', borderRadius: '4px' }}>
                        {agent.connection}
                      </span>
                    </td>
                    {/* Risk */}
                    <td style={{ padding: '16px 24px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 500, color: agent.riskLevel === 'Low' ? '#10b981' : agent.riskLevel === 'Medium' ? '#f59e0b' : '#ef4444' }}>
                        {agent.riskLevel}
                      </span>
                    </td>
                    {/* Status */}
                    <td style={{ padding: '16px 24px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 500, backgroundColor: st.bg, color: st.color }}>
                        {agent.status}
                      </span>
                    </td>
                    {/* Actions */}
                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', opacity: isHovered ? 1 : 0, transition: 'opacity 0.15s' }}>
                        <button style={{ padding: '6px', color: C.outline, background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = C.surfaceHighest; e.currentTarget.style.color = C.onSurface; }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = C.outline; }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>settings</span>
                        </button>
                        <button style={{ padding: '6px', color: C.error, background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(147,0,10,0.2)'}
                          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>emergency</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
