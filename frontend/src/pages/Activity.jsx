import React, { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';
import { MOCK_ACTIVITY, MOCK_CLASSES } from '@/services/mockData';

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

export default function Activity() {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [decisionFilter, setDecisionFilter] = useState('all');
  const [expanded, setExpanded] = useState(new Set());

  const filtered = useMemo(() => {
    return MOCK_ACTIVITY.filter(evt => {
      if (search) {
        const q = search.toLowerCase();
        if (!evt.agent.toLowerCase().includes(q) && !evt.event.toLowerCase().includes(q)) return false;
      }
      if (decisionFilter !== 'all' && evt.type !== decisionFilter) return false;
      return true;
    });
  }, [search, classFilter, decisionFilter]);

  const toggle = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '32px', maxWidth: '1200px', margin: '0 auto', height: '100%' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ ...mono, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.text, margin: '0 0 4px 0' }}>Activity Feed</h2>
          <p style={{ ...mono, fontSize: '11px', color: S.muted, margin: 0 }}>Live stream of every action attempt across the fleet. Updates every few seconds.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.healthy }}>
          <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: S.healthy, animation: 'pulse-ring 2s infinite' }} />
          Live
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={14} color={S.muted} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
          <input 
            type="text" 
            placeholder="Search agent, action, or reason..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '10px 10px 10px 36px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }} 
          />
        </div>
        <select value={classFilter} onChange={e => setClassFilter(e.target.value)} style={{ width: '180px', padding: '10px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }}>
          <option value="all">All Classes</option>
          {MOCK_CLASSES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={decisionFilter} onChange={e => setDecisionFilter(e.target.value)} style={{ width: '120px', padding: '10px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }}>
          <option value="all">All Decisions</option>
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
          <option value="revoke">Revoke</option>
        </select>
        <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>
          {filtered.length} events
        </span>
      </div>

      {/* Feed */}
      <div style={{ ...glass, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {filtered.map(evt => {
          const isExpanded = expanded.has(evt.id);
          const evtColor = evt.type === 'allow' ? S.healthy : (evt.type === 'revoke' ? S.caution : S.stopped);
          return (
            <div key={evt.id} style={{ borderBottom: `1px solid ${S.border}` }}>
              <div onClick={() => toggle(evt.id)} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 20px', cursor: 'pointer', background: isExpanded ? 'rgba(255,255,255,0.02)' : 'transparent', transition: 'background 0.2s' }}>
                <span style={{ color: S.muted }}>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                <span style={{ ...mono, fontSize: '11px', color: S.muted, minWidth: '60px' }}>{evt.ts}</span>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: evtColor }} />
                <span style={{ ...mono, fontSize: '11px', color: S.accent, minWidth: '140px' }}>{evt.agent}</span>
                <span style={{ ...mono, fontSize: '12px', color: S.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evt.event}</span>
                <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: evtColor }}>{evt.type}</span>
              </div>
              {isExpanded && (
                <div style={{ background: S.bgDeep, padding: '16px 20px 16px 52px', borderTop: `1px solid rgba(255,255,255,0.02)` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', ...mono, fontSize: '11px' }}>
                    <div><span style={{ color: S.muted }}>Agent:</span> <span style={{ color: S.text }}>{evt.agent}</span></div>
                    <div><span style={{ color: S.muted }}>Latency:</span> <span style={{ color: S.text }}>42ms</span></div>
                  </div>
                  <div style={{ marginTop: '12px' }}>
                    <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>Event Details</span>
                    <pre style={{ marginTop: '8px', padding: '12px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '6px', ...mono, fontSize: '11px', color: S.text, overflowX: 'auto' }}>
                      {JSON.stringify({ agent: evt.agent, timestamp: evt.ts, details: evt.event, decision: evt.type }, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', ...mono, fontSize: '12px', color: S.muted }}>
            No activity matches the current filters.
          </div>
        )}
      </div>

    </div>
  );
}
