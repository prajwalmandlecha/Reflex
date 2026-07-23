import React, { useState } from 'react';
import { Plus, Plug, Check, AlertCircle, ChevronRight, ChevronLeft, Lock, FileUp, Link2, Keyboard, X } from 'lucide-react';
import { MOCK_CONNECTIONS } from '@/services/mockData';
import { StatusBadge } from '@/components/layout/Layout';

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

const MOCK_TOOLS = [
  { id: 't1', name: 'get_account', method: 'GET', path: '/v1/accounts/{id}', exposed: true },
  { id: 't2', name: 'create_transfer', method: 'POST', path: '/v1/transfers', exposed: true },
  { id: 't3', name: 'get_balance', method: 'GET', path: '/v1/accounts/{id}/balance', exposed: false }
];

export default function BankConnections() {
  const [connections, setConnections] = useState(MOCK_CONNECTIONS);
  const [showWizard, setShowWizard] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ ...mono, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.text, margin: '0 0 4px 0' }}>Bank Connections</h2>
          <p style={{ ...mono, fontSize: '11px', color: S.muted, margin: 0 }}>Registered bank systems and their exposed tools. Agents can only use tools from connected systems.</p>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px',
            border: `1px solid rgba(76,141,255,0.3)`, background: 'rgba(76,141,255,0.1)',
            color: S.accent, ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer'
          }}
        >
          <Plus size={14} /> Add Connection
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '16px' }}>
        {connections.map(conn => (
          <div key={conn.id} style={{ ...glass, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px', borderBottom: `1px solid ${S.border}` }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.05)', border: `1px solid ${S.border}`, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Plug size={18} color={S.accent} />
                </div>
                <div>
                  <h3 style={{ ...mono, fontSize: '14px', color: S.text, margin: '0 0 4px 0' }}>{conn.name}</h3>
                  <div style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, display: 'flex', gap: '6px' }}>
                    <span>{conn.type}</span>·<span>3 tools</span>·<span>Synced {conn.lastHealthCheck}</span>
                  </div>
                </div>
              </div>
              <StatusBadge status={conn.status === 'connected' ? 'active' : 'idle'} label={conn.status} size="xs" />
            </div>

            <div style={{ padding: '20px' }}>
              <div style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '12px' }}>Exposed Tools</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {MOCK_TOOLS.map(tool => tool.exposed && (
                  <div key={tool.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ padding: '4px 6px', borderRadius: '4px', background: tool.method === 'GET' ? 'rgba(61,220,132,0.1)' : 'rgba(76,141,255,0.1)', color: tool.method === 'GET' ? S.healthy : S.accent, ...mono, fontSize: '10px', fontWeight: 600 }}>{tool.method}</span>
                    <span style={{ ...mono, fontSize: '12px', color: S.text }}>{tool.name}</span>
                    <span style={{ ...mono, fontSize: '10px', color: S.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tool.path}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '12px', ...mono, fontSize: '10px', color: 'rgba(139,148,158,0.6)' }}>
                1 tool hidden (not exposed)
              </div>
            </div>
          </div>
        ))}
      </div>

      {showWizard && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '640px', background: S.bgDeep, border: `1px solid rgba(255,255,255,0.1)`, borderRadius: '16px', boxShadow: '0 24px 48px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid rgba(255,255,255,0.1)`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ ...mono, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.text, margin: 0 }}>Add Bank Connection</h3>
              <button onClick={() => setShowWizard(false)} style={{ background: 'transparent', border: 'none', color: S.muted, cursor: 'pointer' }}><X size={20} /></button>
            </div>
            
            <AddConnectionWizard onCancel={() => setShowWizard(false)} />
            
          </div>
        </div>
      )}
    </div>
  );
}

function AddConnectionWizard({ onCancel }) {
  const [step, setStep] = useState(0);
  const [sourceType, setSourceType] = useState('openapi');
  
  const steps = ['Source', 'Endpoints', 'Auth', 'Review'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      
      {/* Step Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '20px 24px', borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
        {steps.map((s, i) => (
          <React.Fragment key={s}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '4px', border: `1px solid ${i === step ? S.accent : (i < step ? S.healthy : S.border)}`, background: i === step ? 'rgba(76,141,255,0.1)' : (i < step ? 'rgba(61,220,132,0.1)' : 'transparent'), color: i === step ? S.accent : (i < step ? S.healthy : S.muted), display: 'flex', alignItems: 'center', justifyContent: 'center', ...mono, fontSize: '10px' }}>
                {i < step ? <Check size={12} /> : i + 1}
              </div>
              <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: i <= step ? S.text : S.muted }}>{s}</span>
            </div>
            {i < steps.length - 1 && <div style={{ flex: 1, height: '1px', background: S.border, margin: '0 12px' }} />}
          </React.Fragment>
        ))}
      </div>

      <div style={{ padding: '24px', minHeight: '300px' }}>
        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <label style={{ display: 'block', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>Choose Source</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {[
                { id: 'openapi', label: 'OpenAPI Spec', icon: FileUp, desc: 'Upload or paste URL' },
                { id: 'native_mcp', label: 'Native MCP', icon: Link2, desc: 'MCP server' },
                { id: 'manual', label: 'Manual Entry', icon: Keyboard, desc: 'Define by hand' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setSourceType(opt.id)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '16px',
                    background: sourceType === opt.id ? 'rgba(76,141,255,0.1)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${sourceType === opt.id ? S.accent : S.border}`, borderRadius: '8px',
                    cursor: 'pointer', transition: 'all 0.2s'
                  }}
                >
                  <opt.icon size={24} color={sourceType === opt.id ? S.accent : S.muted} />
                  <span style={{ ...mono, fontSize: '11px', color: sourceType === opt.id ? S.accent : S.text }}>{opt.label}</span>
                  <span style={{ ...mono, fontSize: '10px', color: S.muted }}>{opt.desc}</span>
                </button>
              ))}
            </div>

            {sourceType === 'openapi' && (
              <div>
                <label style={{ display: 'block', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>OpenAPI Spec URL</label>
                <input type="text" placeholder="https://api.bank.example/openapi.json" style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }} />
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <label style={{ display: 'block', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>Select Endpoints to Expose</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {MOCK_TOOLS.map((tool, idx) => (
                <label key={tool.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" defaultChecked={idx < 2} />
                  <span style={{ padding: '4px 6px', borderRadius: '4px', background: tool.method === 'GET' ? 'rgba(61,220,132,0.1)' : 'rgba(76,141,255,0.1)', color: tool.method === 'GET' ? S.healthy : S.accent, ...mono, fontSize: '10px', fontWeight: 600 }}>{tool.method}</span>
                  <span style={{ ...mono, fontSize: '12px', color: S.text }}>{tool.path}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>Authentication Type</label>
              <select style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }}>
                <option value="bearer">Bearer Token</option>
                <option value="api_key">API Key</option>
                <option value="oauth2">OAuth2</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>Token</label>
              <input type="password" placeholder="••••••••••••" style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...mono, fontSize: '10px', color: S.muted }}>
              <Lock size={12} /> Credential values are encrypted and masked.
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${S.border}`, borderRadius: '8px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', ...mono, fontSize: '12px' }}>
                <div><span style={{ color: S.muted }}>Source:</span> <span style={{ color: S.text }}>{sourceType}</span></div>
                <div><span style={{ color: S.muted }}>Tools:</span> <span style={{ color: S.text }}>2 exposed</span></div>
                <div><span style={{ color: S.muted }}>Auth:</span> <span style={{ color: S.text }}>Bearer Token</span></div>
                <div><span style={{ color: S.muted }}>URL:</span> <span style={{ color: S.text }}>https://api.bank...</span></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div style={{ padding: '16px 24px', background: 'rgba(0,0,0,0.2)', borderTop: `1px solid ${S.border}`, display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={step === 0 ? onCancel : () => setStep(step - 1)} style={{ padding: '10px 20px', borderRadius: '8px', background: 'transparent', border: `1px solid ${S.border}`, color: S.muted, ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {step === 0 ? 'Cancel' : <><ChevronLeft size={14} /> Back</>}
        </button>
        <button onClick={() => { if(step < 3) setStep(step + 1); else onCancel(); }} style={{ padding: '10px 20px', borderRadius: '8px', background: S.accent, border: 'none', color: '#fff', ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {step === 3 ? 'Publish Connection' : <>Continue <ChevronRight size={14} /></>}
        </button>
      </div>

    </div>
  );
}
