import React, { useState } from 'react';
import { Plus, Ban, Wrench, DollarSign, Clock, X } from 'lucide-react';
import { MOCK_CLASSES } from '@/services/mockData';

const S = {
  border: 'rgba(255,255,255,0.06)',
  text: '#e6edf3',
  muted: '#8b949e',
  accent: '#4c8dff',
  healthy: '#3ddc84',
  caution: '#e3b341',
  stopped: '#f85149',
};

const glass = { background: 'rgba(255,255,255,0.03)', border: `1px solid ${S.border}`, borderRadius: '16px' };
const mono = { fontFamily: 'JetBrains Mono, monospace' };

export default function AgentClasses() {
  const [classes, setClasses] = useState(MOCK_CLASSES);
  const [editClass, setEditClass] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>
      
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ ...mono, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.text, margin: '0 0 4px 0' }}>Agent Classes</h2>
          <p style={{ ...mono, fontSize: '11px', color: S.muted, margin: 0 }}>Define default permissions, constraints, and spend caps for groups of agents.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px',
            border: `1px solid rgba(76,141,255,0.3)`, background: 'rgba(76,141,255,0.1)',
            color: S.accent, ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer'
          }}
        >
          <Plus size={14} /> New Class
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '16px' }}>
        {classes.map(cls => (
          <div key={cls.id} style={{ ...glass, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ padding: '20px', borderBottom: `1px solid ${S.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <button onClick={() => setEditClass(cls)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', ...mono, fontSize: '14px', color: S.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{cls.name}</button>
                <p style={{ ...mono, fontSize: '11px', color: S.muted, margin: '6px 0 0 0' }}>{cls.desc}</p>
              </div>
              <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, padding: '4px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: '9999px' }}>
                {cls.activeAgents}/{cls.totalAgents} Active
              </span>
            </div>

            {/* Properties */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: S.border }}>
              <div style={{ background: '#11151d', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                  <Wrench size={12} color={S.muted} />
                  <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>Tools</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {cls.allowedTools.map(t => (
                    <span key={t} style={{ border: `1px solid ${S.border}`, background: 'rgba(255,255,255,0.03)', padding: '4px 8px', borderRadius: '4px', ...mono, fontSize: '10px', color: S.text }}>{t}</span>
                  ))}
                </div>
              </div>
              <div style={{ background: '#11151d', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                  <DollarSign size={12} color={S.muted} />
                  <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>Default Cap</span>
                </div>
                <div style={{ ...mono, fontSize: '13px', color: S.text }}>
                  {cls.defaultCap ? `$${cls.defaultCap.toLocaleString()} / day` : 'No spend cap'}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', borderTop: `1px solid ${S.border}`, marginTop: 'auto' }}>
              <button onClick={() => setEditClass(cls)} style={{ background: 'transparent', border: 'none', color: S.accent, ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', padding: '6px 12px', borderRadius: '6px' }}>
                Edit Class
              </button>
              <button style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', color: S.stopped, ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', padding: '6px 12px', borderRadius: '6px' }}>
                <Ban size={12} /> Revoke Instances
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit/Create Modal */}
      {(editClass || showCreate) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '600px', background: '#0d1117', border: `1px solid rgba(255,255,255,0.1)`, borderRadius: '16px', boxShadow: '0 24px 48px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid rgba(255,255,255,0.1)`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ ...mono, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.text, margin: 0 }}>
                {editClass ? `Edit ${editClass.name}` : 'Create Agent Class'}
              </h3>
              <button onClick={() => { setEditClass(null); setShowCreate(false); }} style={{ background: 'transparent', border: 'none', color: S.muted, cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              <div>
                <label style={{ display: 'block', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>Class Name</label>
                <input type="text" defaultValue={editClass?.name || ''} placeholder="e.g. Treasury Operations" style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }} />
              </div>

              <div>
                <label style={{ display: 'block', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>Allowed Tools</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  {['wire_transfer', 'ach_transfer', 'balance_check', 'fx_quote', 'sanctions_check', 'kyc_lookup', 'statement_fetch'].map(tool => (
                    <label key={tool} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'rgba(255,255,255,0.03)', border: `1px solid rgba(255,255,255,0.06)`, borderRadius: '6px', cursor: 'pointer' }}>
                      <input type="checkbox" defaultChecked={editClass?.allowedTools?.includes(tool)} />
                      <span style={{ ...mono, fontSize: '11px', color: S.text }}>{tool}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>Default Spend Cap ($)</label>
                  <input type="number" defaultValue={editClass?.defaultCap || 0} style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }} />
                </div>
                <div>
                  <label style={{ display: 'block', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>Cap Window</label>
                  <select defaultValue="day" style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }}>
                    <option value="day">Day</option>
                    <option value="month">Month</option>
                  </select>
                </div>
              </div>

            </div>
            <div style={{ padding: '16px 24px', borderTop: `1px solid rgba(255,255,255,0.1)`, background: 'rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button onClick={() => { setEditClass(null); setShowCreate(false); }} style={{ padding: '10px 20px', borderRadius: '8px', border: `1px solid rgba(255,255,255,0.1)`, background: 'transparent', color: S.muted, ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => { setEditClass(null); setShowCreate(false); }} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: S.accent, color: '#fff', ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}>{editClass ? 'Save Changes' : 'Create Class'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
