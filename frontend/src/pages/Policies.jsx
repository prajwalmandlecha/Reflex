import React, { useState } from 'react';
import { Plus, CheckCircle2, XCircle, Pencil, Code2, Play, FileText, FileJson } from 'lucide-react';
import { MOCK_POLICIES, MOCK_CLASSES } from '@/services/mockData';
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

export default function Policies() {
  const [policies, setPolicies] = useState(MOCK_POLICIES);
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '32px', maxWidth: '1200px', margin: '0 auto', height: '100%' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ ...mono, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.text, margin: '0 0 4px 0' }}>Policies</h2>
          <p style={{ ...mono, fontSize: '11px', color: S.muted, margin: 0 }}>Author governance rules visually or in Rego. Validate and dry-run before activating.</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setSelectedPolicy(null); }}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px',
            border: `1px solid rgba(76,141,255,0.3)`, background: 'rgba(76,141,255,0.1)',
            color: S.accent, ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer'
          }}
        >
          <Plus size={14} /> New Policy
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', flex: 1, minHeight: 0 }}>
        
        {/* Left: Policy List */}
        <div style={{ ...glass, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${S.border}` }}>
            <h3 style={{ ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, margin: 0 }}>All Policies</h3>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
            {policies.map(pol => (
              <button
                key={pol.id}
                onClick={() => { setSelectedPolicy(pol); setShowCreate(false); }}
                style={{
                  display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px 20px',
                  background: selectedPolicy?.id === pol.id ? 'rgba(76,141,255,0.1)' : 'transparent',
                  border: 'none', borderBottom: `1px solid ${S.border}`, cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={e => { if (selectedPolicy?.id !== pol.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                onMouseLeave={e => { if (selectedPolicy?.id !== pol.id) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <span style={{ ...mono, fontSize: '12px', color: S.text }}>{pol.name}</span>
                  <StatusBadge status={pol.status === 'enforced' ? 'active' : 'idle'} label={pol.status} size="xs" />
                </div>
                <div style={{ ...mono, fontSize: '10px', color: S.muted, display: 'flex', gap: '6px' }}>
                  <span>{pol.priority}</span>·<span>{pol.affects}</span>
                </div>
                <div style={{ ...mono, fontSize: '9px', color: 'rgba(139,148,158,0.6)', marginTop: '4px' }}>
                  Created: {pol.created}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Policy Editor */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selectedPolicy || showCreate ? (
            <PolicyEditor policy={selectedPolicy} isNew={showCreate} classes={MOCK_CLASSES} />
          ) : (
            <div style={{ ...glass, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
              <FileText size={32} color="rgba(139,148,158,0.4)" />
              <p style={{ ...mono, fontSize: '11px', color: S.muted }}>Select a policy to view or edit, or create a new one.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function PolicyEditor({ policy, isNew, classes }) {
  const [mode, setMode] = useState('rego'); // visual | rego
  const [regoSource, setRegoSource] = useState(
    policy?.rule || `package governance.guard\n\ndefault allow := false\n\nallow if {\n  input.action == ""\n  input.params.amount <= 100000\n}\n\ndeny[msg] if {\n  input.action == ""\n  input.params.amount > 100000\n  msg := "Amount exceeds limit"\n}`
  );
  const [validationResult, setValidationResult] = useState(null);
  const [dryRunResult, setDryRunResult] = useState(null);

  const handleValidate = () => {
    const hasPackage = regoSource.includes('package') || regoSource.includes('deny') || regoSource.includes('allow');
    if (!hasPackage) {
      setValidationResult({ ok: false, message: 'Missing required elements: package declaration or rule.' });
    } else {
      setValidationResult({ ok: true, message: 'Rego syntax valid — 0 errors, 0 warnings.' });
    }
  };

  const handleDryRun = () => {
    setDryRunResult({
      allowed: 142,
      denied: 18,
      changed: [
        { action: 'wire_transfer $250,000 → ACME Corp', was: 'allow', now: 'deny' },
        { action: 'market_order AAPL ×60,000', was: 'allow', now: 'deny' },
        { action: 'sepa_transfer €78,000 → Initech', was: 'deny', now: 'allow' },
      ]
    });
  };

  return (
    <div style={{ ...glass, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${S.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ ...mono, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.text, margin: 0 }}>
          {isNew ? 'New Policy' : policy?.name}
        </h3>
        {policy && <StatusBadge status={policy.status === 'enforced' ? 'active' : 'idle'} label={policy.status} size="xs" />}
      </div>

      <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {isNew && (
          <div>
            <label style={{ display: 'block', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>Policy Name</label>
            <input type="text" placeholder="e.g. Treasury Wire Cap Guard" style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }} />
          </div>
        )}

        <div>
          <label style={{ display: 'block', ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>Scope</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <select style={{ width: '120px', padding: '10px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }}>
              <option value="class">Class</option>
              <option value="instance">Instance</option>
            </select>
            <select style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`, borderRadius: '8px', color: S.text, ...mono, fontSize: '12px' }}>
              <option value="all">All Agents</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {/* Editor Tabs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '8px', width: 'fit-content' }}>
            <button onClick={() => setMode('visual')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', background: mode === 'visual' ? 'rgba(255,255,255,0.1)' : 'transparent', color: mode === 'visual' ? S.text : S.muted, border: 'none', cursor: 'pointer', ...mono, fontSize: '11px' }}>
              <Pencil size={12} /> Visual Builder
            </button>
            <button onClick={() => setMode('rego')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', background: mode === 'rego' ? 'rgba(255,255,255,0.1)' : 'transparent', color: mode === 'rego' ? S.text : S.muted, border: 'none', cursor: 'pointer', ...mono, fontSize: '11px' }}>
              <Code2 size={12} /> Rego Editor
            </button>
          </div>

          {mode === 'rego' ? (
            <div style={{ border: `1px solid ${S.border}`, background: S.bgDeep, borderRadius: '8px', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '250px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: `1px solid ${S.border}`, background: 'rgba(255,255,255,0.02)' }}>
                <FileJson size={12} color={S.muted} />
                <span style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>policy.rego</span>
              </div>
              <textarea
                value={regoSource}
                onChange={e => setRegoSource(e.target.value)}
                spellCheck={false}
                style={{ flex: 1, background: 'transparent', border: 'none', padding: '16px', color: S.accent, ...mono, fontSize: '12px', lineHeight: 1.6, resize: 'none', outline: 'none' }}
              />
            </div>
          ) : (
            <div style={{ border: `1px solid ${S.border}`, background: 'rgba(255,255,255,0.02)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, minHeight: '250px' }}>
              <span style={{ ...mono, fontSize: '11px', color: S.muted }}>Visual builder not fully configured for this mock. Toggle to Rego Editor.</span>
            </div>
          )}
        </div>

        {/* Validation & Dry Run Tools */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '16px', borderTop: `1px solid ${S.border}` }}>
          <button onClick={handleValidate} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'transparent', border: `1px solid ${S.border}`, borderRadius: '8px', color: S.text, cursor: 'pointer', ...mono, fontSize: '11px' }}>
            <CheckCircle2 size={14} /> Validate
          </button>
          <button onClick={handleDryRun} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'transparent', border: `1px solid ${S.border}`, borderRadius: '8px', color: S.text, cursor: 'pointer', ...mono, fontSize: '11px' }}>
            <Play size={14} /> Dry run
          </button>
          
          {validationResult && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', ...mono, fontSize: '11px', color: validationResult.ok ? S.healthy : S.stopped, marginLeft: 'auto' }}>
              {validationResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {validationResult.message}
            </span>
          )}
        </div>

        {/* Dry Run Results */}
        {dryRunResult && (
          <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${S.border}`, borderRadius: '8px', padding: '16px' }}>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', ...mono, fontSize: '11px' }}>
              <span style={{ color: S.healthy }}>{dryRunResult.allowed} would be allowed</span>
              <span style={{ color: S.stopped }}>{dryRunResult.denied} would be denied</span>
            </div>
            <div style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted, marginBottom: '8px' }}>Changed Decisions ({dryRunResult.changed.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {dryRunResult.changed.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '6px', borderBottom: `1px solid ${S.border}` }}>
                  <span style={{ flex: 1, ...mono, fontSize: '11px', color: S.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.action}</span>
                  <span style={{ ...mono, fontSize: '10px', color: S.healthy }}>{c.was}</span>
                  <span style={{ ...mono, fontSize: '10px', color: S.muted }}>→</span>
                  <span style={{ ...mono, fontSize: '10px', color: S.stopped }}>{c.now}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div style={{ padding: '16px 20px', background: 'rgba(0,0,0,0.2)', borderTop: `1px solid ${S.border}`, display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        <button style={{ padding: '10px 20px', borderRadius: '8px', background: 'transparent', border: `1px solid ${S.border}`, color: S.muted, ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}>Save Draft</button>
        <button style={{ padding: '10px 20px', borderRadius: '8px', background: S.healthy, border: 'none', color: '#000', fontWeight: 600, ...mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}>Activate Policy</button>
      </div>

    </div>
  );
}
