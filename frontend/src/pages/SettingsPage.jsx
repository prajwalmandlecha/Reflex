import React from 'react';
import { DollarSign, Bell, User, Mail, Shield } from 'lucide-react';

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

export default function SettingsPage() {
  const operator = "admin.operator";

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '32px', maxWidth: '1000px', margin: '0 auto' }}>
      
      {/* Header */}
      <div>
        <h2 style={{ ...mono, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.text, margin: '0 0 4px 0' }}>Settings</h2>
        <p style={{ ...mono, fontSize: '11px', color: S.muted, margin: 0 }}>Default spend cap templates, notification preferences, and operator profile.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        
        {/* Spend Cap Templates */}
        <div style={{ ...glass, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${S.border}` }}>
            <h3 style={{ ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, margin: 0 }}>Default Spend Cap Templates</h3>
          </div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ ...mono, fontSize: '10px', color: S.muted, margin: '0 0 8px 0', lineHeight: 1.5 }}>Pre-configured cap templates that can be applied when creating or editing agent classes.</p>
            {[
              { name: 'Conservative', amount: 500000, window: 'day' },
              { name: 'Standard', amount: 2000000, window: 'day' },
              { name: 'High Volume', amount: 10000000, window: 'day' },
              { name: 'Monthly Operations', amount: 50000000, window: 'month' },
            ].map(tpl => (
              <div key={tpl.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '8px' }}>
                <div>
                  <div style={{ ...mono, fontSize: '11px', color: S.text, marginBottom: '2px' }}>{tpl.name}</div>
                  <div style={{ ...mono, fontSize: '10px', color: S.muted }}>${tpl.amount.toLocaleString()} / {tpl.window}</div>
                </div>
                <DollarSign size={14} color={S.muted} />
              </div>
            ))}
          </div>
        </div>

        {/* Notification Preferences */}
        <div style={{ ...glass, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${S.border}` }}>
            <h3 style={{ ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, margin: 0 }}>Notification Preferences</h3>
          </div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              { label: 'Cap breach warnings (80%)', desc: 'Notify when any agent reaches 80% of its daily cap', defaultOn: true },
              { label: 'Agent revocation', desc: 'Notify when an agent is revoked or killed', defaultOn: true },
              { label: 'Policy changes', desc: 'Notify when a policy is activated or modified', defaultOn: true },
              { label: 'Fleet emergency stop', desc: 'Notify on any fleet-wide stop event', defaultOn: true },
              { label: 'Bank connection errors', desc: 'Notify when a bank connection enters error state', defaultOn: false },
            ].map(pref => (
              <label key={pref.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '8px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <Bell size={14} color={S.muted} style={{ marginTop: '2px' }} />
                  <div>
                    <div style={{ ...mono, fontSize: '11px', color: S.text, marginBottom: '2px' }}>{pref.label}</div>
                    <div style={{ ...mono, fontSize: '10px', color: S.muted }}>{pref.desc}</div>
                  </div>
                </div>
                <input type="checkbox" defaultChecked={pref.defaultOn} style={{ accentColor: S.accent }} />
              </label>
            ))}
          </div>
        </div>

        {/* Operator Profile */}
        <div style={{ ...glass, gridColumn: '1 / -1', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${S.border}` }}>
            <h3 style={{ ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, margin: 0 }}>Operator Profile</h3>
          </div>
          <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(76,141,255,0.1)', border: `1px solid rgba(76,141,255,0.3)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <User size={24} color={S.accent} />
              </div>
              <div>
                <div style={{ ...mono, fontSize: '14px', color: S.text }}>{operator}</div>
                <div style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginTop: '2px' }}>Compliance Operator</div>
              </div>
            </div>
            <div>
              <div style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>Email</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...mono, fontSize: '12px', color: S.text }}>
                <Mail size={14} color={S.muted} /> {operator}@guardian.local
              </div>
            </div>
            <div>
              <div style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>Role</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...mono, fontSize: '12px', color: S.text }}>
                <Shield size={14} color={S.muted} /> Full Governance Access
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
