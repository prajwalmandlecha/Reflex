import React, { useState, useMemo } from 'react';
import { MOCK_AGENTS, MOCK_CLASSES, MOCK_ACTIVITY } from '@/services/mockData';
import { StatusBadge } from '@/components/layout/Layout';
import { Search, Ban, Shield, Clock, Wrench, ChevronRight, X } from 'lucide-react';

const S = {
  border: 'rgba(255,255,255,0.06)',
  text: '#e6edf3',
  muted: '#8b949e',
  accent: '#4c8dff',
  healthy: '#3ddc84',
  caution: '#e3b341',
  stopped: '#f85149',
  bgDeep: '#0d1117',
};

const glass = { background: 'rgba(255,255,255,0.03)', border: `1px solid ${S.border}`, borderRadius: '16px' };
const mono = { fontFamily: 'JetBrains Mono, monospace' };

export default function Agents() {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [showRevokeModal, setShowRevokeModal] = useState(false);

  const filtered = useMemo(() => {
    return MOCK_AGENTS.filter(inst => {
      if (search && !inst.id.toLowerCase().includes(search.toLowerCase()) && !inst.name.toLowerCase().includes(search.toLowerCase())) return false;
      
      // We map our mock agent classes loosely since mockData structure differs slightly
      const mockClassId = inst.class.toLowerCase().replace(' ', '-');
      if (classFilter !== 'all' && mockClassId !== classFilter && inst.class !== classFilter) return false;
      
      const st = { active: 'active', revoked: 'revoked', idle: 'idle' }[inst.status] || inst.status;
      if (statusFilter !== 'all' && st !== statusFilter) return false;
      return true;
    });
  }, [search, classFilter, statusFilter]);

  const selectedAgent = MOCK_AGENTS.find(i => i.id === selectedAgentId) || null;
  const agentActivity = selectedAgent ? MOCK_ACTIVITY.filter(e => e.agent === selectedAgent.name).slice(0, 12) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '32px', maxWidth: '1400px', margin: '0 auto', height: '100%' }}>
      
      {/* Header & Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={14} color={S.muted} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
          <input 
            type="text" 
            placeholder="Search by agent name or ID..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '10px 10px 10px 36px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }} 
          />
        </div>
        <select value={classFilter} onChange={e => setClassFilter(e.target.value)} style={{ width: '180px', padding: '10px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }}>
          <option value="all">All Classes</option>
          {MOCK_CLASSES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: '140px', padding: '10px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }}>
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="idle">Idle</option>
          <option value="revoked">Revoked</option>
          <option value="killed">Killed</option>
        </select>
        <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>
          {filtered.length} of {MOCK_AGENTS.length} agents
        </span>
      </div>

      <div style={{ display: 'flex', gap: '24px', flex: 1, minHeight: 0 }}>
        {/* Table */}
        <div style={{ ...glass, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', backdropFilter: 'blur(10px)', zIndex: 10 }}>
              <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                {['Agent ID', 'Class', 'Status', 'Spend / Cap', 'Last Action', 'Last Seen', ''].map(h => (
                  <th key={h} style={{ padding: '12px 20px', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inst => {
                const pct = inst.capPercent;
                const barColor = pct >= 100 ? S.stopped : pct >= 80 ? S.caution : S.healthy;
                const st = { active: 'healthy', revoked: 'stopped', idle: 'idle', killed: 'stopped' }[inst.status] || 'idle';
                
                return (
                  <tr key={inst.id} onClick={() => setSelectedAgentId(inst.id)} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)`, cursor: 'pointer', background: selectedAgentId === inst.id ? 'rgba(79,142,255,0.06)' : 'transparent', transition: 'background 0.15s' }}>
                    <td style={{ padding: '12px 20px', ...mono, fontSize: '12px', color: S.accent }}>
                      {inst.name} <div style={{ fontSize: '9px', color: S.muted, marginTop: '2px' }}>{inst.id}</div>
                    </td>
                    <td style={{ padding: '12px 20px', ...mono, fontSize: '11px', color: S.text }}>{inst.class}</td>
                    <td style={{ padding: '12px 20px' }}><StatusBadge status={st} label={inst.status} size="xs" /></td>
                    <td style={{ padding: '12px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '60px', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: barColor }} />
                        </div>
                        <span style={{ ...mono, fontSize: '10px', color: S.muted }}>${inst.spend.toFixed(0)}/${inst.cap}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 20px', ...mono, fontSize: '11px', color: S.text }}>{inst.actions} total actions</td>
                    <td style={{ padding: '12px 20px', ...mono, fontSize: '10px', color: S.muted }}>{inst.lastSeen || '2 mins ago'}</td>
                    <td style={{ padding: '12px 20px', textAlign: 'right', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>View <ChevronRight size={12} /></span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '32px', textAlign: 'center', ...mono, fontSize: '12px', color: S.muted }}>No agents match the current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Detail Panel */}
        {selectedAgent && (
          <aside className="glass-strong" style={{ width: '400px', flexShrink: 0, borderRadius: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'fade-in 0.2s ease-out' }}>
            <div style={{ padding: '20px', borderBottom: `1px solid ${S.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ ...mono, fontSize: '14px', color: S.text, margin: '0 0 6px 0' }}>{selectedAgent.name}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <StatusBadge status={{ active: 'healthy', revoked: 'stopped', idle: 'idle', killed: 'stopped' }[selectedAgent.status] || 'idle'} label={selectedAgent.status} size="xs" />
                  <span style={{ ...mono, fontSize: '10px', color: S.muted }}>{selectedAgent.class}</span>
                </div>
              </div>
              <button onClick={() => setSelectedAgentId(null)} style={{ background: 'transparent', border: 'none', color: S.muted, cursor: 'pointer' }}><X size={18} /></button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {/* Spend */}
              <div style={{ padding: '20px', borderBottom: `1px solid ${S.border}` }}>
                <div style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>Spend Today</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '12px' }}>
                  <span style={{ ...mono, fontSize: '24px', color: S.text }}>${selectedAgent.spend.toFixed(0)}</span>
                  <span style={{ ...mono, fontSize: '12px', color: S.muted }}>/ ${selectedAgent.cap} cap</span>
                </div>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(selectedAgent.capPercent, 100)}%`, background: selectedAgent.capPercent >= 100 ? S.stopped : selectedAgent.capPercent >= 80 ? S.caution : S.healthy }} />
                </div>
                {selectedAgent.capPercent > 80 && (
                  <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px', ...mono, fontSize: '10px', color: S.caution }}>
                    <Shield size={12} /> Instance cap override active
                  </div>
                )}
              </div>

              {/* Effective Permissions */}
              <div style={{ padding: '20px', borderBottom: `1px solid ${S.border}` }}>
                <div style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '12px' }}>Effective Permissions</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Wrench size={14} color={S.muted} />
                  <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>Allowed Tools</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingLeft: '22px' }}>
                  {selectedAgent.permissions.map(tool => (
                    <span key={tool} style={{ border: `1px solid rgba(255,255,255,0.1)`, background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px', ...mono, fontSize: '10px', color: S.text }}>{tool}</span>
                  ))}
                  {selectedAgent.permissions.length === 0 && <span style={{ ...mono, fontSize: '10px', color: S.stopped }}>All permissions revoked</span>}
                </div>
              </div>

              {/* Recent Actions */}
              <div style={{ padding: '20px', borderBottom: `1px solid ${S.border}`, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <Clock size={14} color={S.muted} />
                  <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>Recent Actions</span>
                </div>
                {agentActivity.length === 0 ? (
                  <p style={{ paddingLeft: '22px', ...mono, fontSize: '11px', color: S.muted }}>No recent activity for this instance.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingLeft: '22px' }}>
                    {agentActivity.map((evt, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: evt.type === 'allow' ? S.healthy : S.stopped }} />
                        <span style={{ ...mono, fontSize: '10px', color: S.muted, minWidth: '50px' }}>{evt.ts}</span>
                        <span style={{ flex: 1, ...mono, fontSize: '11px', color: S.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evt.event}</span>
                        <span style={{ ...mono, fontSize: '9px', textTransform: 'uppercase', color: evt.type === 'allow' ? S.healthy : S.stopped }}>{evt.type}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer / Revoke */}
            <div style={{ padding: '20px', background: 'rgba(0,0,0,0.2)' }}>
              {selectedAgent.status !== 'killed' && selectedAgent.status !== 'revoked' && (
                <button 
                  onClick={() => setShowRevokeModal(true)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', borderRadius: '8px', border: `1px solid rgba(248,81,73,0.3)`, background: 'transparent', color: S.stopped, ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', transition: 'all 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,81,73,0.1)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <Ban size={14} /> Revoke this instance
                </button>
              )}
              <div style={{ ...mono, fontSize: '10px', color: S.muted, marginTop: selectedAgent.status === 'active' ? '12px' : '0' }}>
                Last seen: {selectedAgent.lastSeen || 'Just now'}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Revoke Modal */}
      {showRevokeModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-strong" style={{ width: '400px', borderRadius: '16px', overflow: 'hidden', border: `1px solid rgba(255,255,255,0.1)` }}>
            <div style={{ padding: '24px' }}>
              <h3 style={{ ...mono, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.text, margin: '0 0 12px 0' }}>Revoke {selectedAgent?.id}?</h3>
              <p style={{ ...mono, fontSize: '12px', color: S.muted, margin: 0, lineHeight: 1.5 }}>
                This will immediately revoke the instance. All pending actions will be denied. The instance can be reactivated from the Emergency Stop page.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px', padding: '16px 24px', background: 'rgba(0,0,0,0.2)', borderTop: `1px solid rgba(255,255,255,0.05)` }}>
              <button onClick={() => setShowRevokeModal(false)} style={{ flex: 1, padding: '10px', borderRadius: '8px', background: 'transparent', border: `1px solid rgba(255,255,255,0.1)`, color: S.text, ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => setShowRevokeModal(false)} style={{ flex: 1, padding: '10px', borderRadius: '8px', background: S.stopped, border: 'none', color: '#fff', ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', fontWeight: 600 }}>Revoke Instance</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
