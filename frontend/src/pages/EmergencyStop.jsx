import React, { useState } from 'react';
import { Octagon, Ban, Play } from 'lucide-react';
import { StatusBadge } from '@/components/layout/Layout';
import { MOCK_AGENTS, MOCK_CLASSES } from '@/services/mockData';

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

function Panel({ title, children, glowColor }) {
  return (
    <div style={{ ...glass, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: glowColor ? `0 0 24px -4px ${glowColor}20` : 'none' }}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${S.border}`, display: 'flex', alignItems: 'center' }}>
        <h3 style={{ ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, margin: 0 }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

function StatTile({ label, value, color }) {
  return (
    <div style={{ padding: '20px', borderRight: `1px solid ${S.border}`, flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>{label}</span>
      <span style={{ ...mono, fontSize: '24px', color }}>{value}</span>
    </div>
  );
}

export default function EmergencyStop() {
  const [instances, setInstances] = useState(MOCK_AGENTS);
  const [fleetState, setFleetState] = useState('idle'); // idle | arming | armed | stopped
  const [progress, setProgress] = useState(0);
  const timerRef = React.useRef(null);

  const activeCount = instances.filter(i => i.status === 'active').length;
  const killedCount = instances.filter(i => i.status === 'killed').length;
  const revokedCount = instances.filter(i => i.status === 'revoked').length;

  function handleStopFleet() {
    setFleetState('stopped');
    setInstances(prev => prev.map(i => i.status === 'active' ? { ...i, status: 'killed' } : i));
  }

  function handleStopClass(classId) {
    setInstances(prev => prev.map(i => (i.class === classId && i.status === 'active') ? { ...i, status: 'killed' } : i));
  }

  function handleStopInstance(id) {
    setInstances(prev => prev.map(i => i.id === id ? { ...i, status: 'killed' } : i));
  }

  function handleResumeInstance(id) {
    setInstances(prev => prev.map(i => i.id === id ? { ...i, status: 'active' } : i));
  }

  function startArm() {
    setFleetState('arming');
    let p = 0;
    timerRef.current = setInterval(() => {
      p += 2;
      setProgress(p);
      if (p >= 100) {
        clearInterval(timerRef.current);
        setFleetState('armed');
      }
    }, 40);
  }

  function cancelArm() {
    clearInterval(timerRef.current);
    setFleetState('idle');
    setProgress(0);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '32px', maxWidth: '1000px', margin: '0 auto' }}>
      
      {/* Fleet-Wide Stop */}
      <div style={{ ...glass, border: `1px solid rgba(248,81,73,0.3)`, background: 'rgba(248,81,73,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 32px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <Octagon size={20} color={S.stopped} />
            <span style={{ ...mono, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.text }}>Stop Entire Fleet</span>
          </div>
          <p style={{ ...mono, fontSize: '11px', color: S.muted, margin: 0, maxWidth: '400px', lineHeight: 1.5 }}>
            Immediately kills all {activeCount} active agents across every class. All pending actions will be denied. Requires press-and-hold + confirm.
          </p>
        </div>
        
        {fleetState === 'stopped' ? (
          <div style={{ padding: '12px 24px', borderRadius: '12px', border: `1px solid ${S.stopped}30`, background: 'rgba(248,81,73,0.08)', ...mono, fontSize: '12px', color: S.stopped, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Fleet Halted
          </div>
        ) : fleetState === 'armed' ? (
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={cancelArm} style={{ ...mono, fontSize: '11px', padding: '10px 24px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: S.muted, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Cancel</button>
            <button onClick={handleStopFleet} style={{ ...mono, fontSize: '11px', padding: '10px 24px', borderRadius: '10px', background: 'rgba(248,81,73,0.15)', border: '1px solid rgba(248,81,73,0.4)', color: S.stopped, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Confirm Halt</button>
          </div>
        ) : (
          <button
            onMouseDown={startArm} onMouseUp={fleetState === 'arming' ? cancelArm : undefined} onMouseLeave={fleetState === 'arming' ? cancelArm : undefined}
            style={{
              position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: '10px',
              padding: '12px 24px', borderRadius: '12px', border: `1px solid rgba(248,81,73,0.35)`, background: 'rgba(248,81,73,0.1)', color: S.stopped,
              ...mono, fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
            }}
          >
            <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${progress}%`, background: 'rgba(248,81,73,0.25)', transition: 'none' }} />
            <span style={{ position: 'relative', zIndex: 1 }}>{fleetState === 'arming' ? `Hold… ${progress}%` : 'Press & Hold to Arm'}</span>
          </button>
        )}
      </div>

      {/* Summary Stats */}
      <div style={{ ...glass, display: 'flex', overflow: 'hidden' }}>
        <StatTile label="Active" value={activeCount} color={S.healthy} />
        <StatTile label="Revoked" value={revokedCount} color={S.caution} />
        <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>Killed</span>
          <span style={{ ...mono, fontSize: '24px', color: S.stopped }}>{killedCount}</span>
        </div>
      </div>

      {/* Per-Class Stop */}
      <Panel title="Per-Class Stop">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: S.border }}>
          {MOCK_CLASSES.map(cls => {
            const clsInstances = instances.filter(i => i.class === cls.id || (cls.id === 'support' && i.name.includes('Support')) || (cls.id === 'finance' && i.name.includes('Finance')));
            const clsActive = clsInstances.filter(i => i.status === 'active').length;
            const clsKilled = clsInstances.filter(i => i.status === 'killed').length;
            
            return (
              <div key={cls.id} style={{ background: '#0d1117', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ ...mono, fontSize: '13px', color: S.text, display: 'block', marginBottom: '4px' }}>{cls.name}</span>
                  <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>
                    {clsActive} active · {clsKilled} killed
                  </span>
                </div>
                <button 
                  onClick={() => handleStopClass(cls.id)}
                  disabled={clsActive === 0}
                  style={{ 
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '8px',
                    background: clsActive > 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${clsActive > 0 ? 'rgba(248,81,73,0.3)' : 'rgba(255,255,255,0.05)'}`,
                    color: clsActive > 0 ? S.stopped : 'rgba(139,148,158,0.5)',
                    cursor: clsActive > 0 ? 'pointer' : 'not-allowed',
                    ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em'
                  }}
                >
                  <Ban size={12} /> Stop All
                </button>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* Per-Instance Controls */}
      <Panel title="Per-Instance Controls">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${S.border}` }}>
              {['Agent', 'Class', 'Status', 'Action'].map(h => (
                <th key={h} style={{ padding: '12px 20px', textAlign: 'left', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {instances.map(inst => (
              <tr key={inst.id} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                <td style={{ padding: '12px 20px', ...mono, fontSize: '12px', color: S.text }}>{inst.name}</td>
                <td style={{ padding: '12px 20px', ...mono, fontSize: '12px', color: S.muted }}>{inst.class || 'General'}</td>
                <td style={{ padding: '12px 20px' }}><StatusBadge status={inst.status} label={inst.status} /></td>
                <td style={{ padding: '12px 20px' }}>
                  {inst.status === 'active' && (
                    <button onClick={() => handleStopInstance(inst.id)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.2)', color: S.stopped, padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      <Ban size={12} /> Stop
                    </button>
                  )}
                  {inst.status === 'killed' && (
                    <button onClick={() => handleResumeInstance(inst.id)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(61,220,132,0.1)', border: '1px solid rgba(61,220,132,0.2)', color: S.healthy, padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      <Play size={12} /> Resume
                    </button>
                  )}
                  {inst.status === 'revoked' && (
                    <span style={{ ...mono, fontSize: '10px', color: S.muted, textTransform: 'uppercase' }}>Manage in Agent</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

    </div>
  );
}
