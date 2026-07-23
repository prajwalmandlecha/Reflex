import React, { useState, useMemo, useEffect } from 'react';
import { Search, Download, Lock, ArrowRight } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

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

export default function AuditLog() {
  const { auditLogs, fetchAuditLogs } = useAppStore();
  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('all');

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const filtered = useMemo(() => {
    return auditLogs.filter(e => {
      if (search) {
        const q = search.toLowerCase();
        if (!e.agent.toLowerCase().includes(q) && !e.tool.toLowerCase().includes(q) && !e.action.toLowerCase().includes(q)) return false;
      }
      if (outcomeFilter !== 'all' && e.result !== outcomeFilter) return false;
      return true;
    });
  }, [search, outcomeFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '32px', maxWidth: '1200px', margin: '0 auto', height: '100%' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ ...mono, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.text, margin: '0 0 4px 0' }}>Audit Log</h2>
          <p style={{ ...mono, fontSize: '11px', color: S.muted, margin: 0 }}>Complete, append-only history of agent actions, policy evaluations, and system events.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>
            <Lock size={12} /> Immutable / Append-only
          </div>
          <button style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px', background: 'transparent', border: `1px solid ${S.border}`, color: S.text, cursor: 'pointer', ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={14} color={S.muted} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
          <input 
            type="text" 
            placeholder="Search agent, tool, action..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '10px 10px 10px 36px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }} 
          />
        </div>
        <select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)} style={{ width: '160px', padding: '10px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }}>
          <option value="all">All Outcomes</option>
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
        <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>
          {filtered.length} entries
        </span>
      </div>

      {/* Table */}
      <div style={{ ...glass, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', backdropFilter: 'blur(10px)', zIndex: 10 }}>
            <tr style={{ borderBottom: `1px solid ${S.border}` }}>
              {['Timestamp', 'ID', 'Agent', 'Action', 'Tool', 'Outcome', 'Risk', 'Hash'].map(h => (
                <th key={h} style={{ padding: '12px 20px', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(entry => (
              <tr key={entry.id} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                <td style={{ padding: '12px 20px', ...mono, fontSize: '11px', color: S.muted, whiteSpace: 'nowrap' }}>{entry.ts}</td>
                <td style={{ padding: '12px 20px', ...mono, fontSize: '10px', color: S.muted }}>{entry.id}</td>
                <td style={{ padding: '12px 20px', ...mono, fontSize: '11px', color: S.accent, whiteSpace: 'nowrap' }}>{entry.agent}</td>
                <td style={{ padding: '12px 20px', ...mono, fontSize: '11px', color: S.text }}>{entry.action}</td>
                <td style={{ padding: '12px 20px', ...mono, fontSize: '11px', color: S.text }}>{entry.tool}</td>
                <td style={{ padding: '12px 20px' }}>
                  <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: entry.result === 'allow' ? S.healthy : S.stopped }}>
                    {entry.result}
                  </span>
                </td>
                <td style={{ padding: '12px 20px', ...mono, fontSize: '11px', color: entry.risk > 0.5 ? S.stopped : (entry.risk > 0.2 ? S.caution : S.muted) }}>
                  {entry.risk.toFixed(2)}
                </td>
                <td style={{ padding: '12px 20px', ...mono, fontSize: '10px', color: 'rgba(139,148,158,0.5)' }}>{entry.hash}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '32px', textAlign: 'center', ...mono, fontSize: '12px', color: S.muted }}>
                  No audit entries match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
