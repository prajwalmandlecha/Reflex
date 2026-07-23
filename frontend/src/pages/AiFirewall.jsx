import React, { useEffect, useState } from 'react';
import { ShieldAlert, Info, BrainCircuit, Shield, ShieldCheck } from 'lucide-react';

const C = {
  error:      '#ff4f4f',
  tertiary:   '#a78bfa',
  secondary:  '#7ab3ff',
  onSurface:  '#e8eef7',
  onSurfaceV: '#7d8fa8',
  outline:    'rgba(255,255,255,0.07)',
};

const BLOCKED = [
  { time: '14:22:01:002', source: 'USR-88219', model: 'GPT-4o', category: 'PROMPT_INJECTION', categoryColor: C.error, categoryBg: 'rgba(255,79,79,0.1)', action: 'BLOCKED_HARD', score: '0.98', scoreColor: C.error },
  { time: '14:21:58:119', source: 'AGENT-A_3', model: 'Claude 3.5', category: 'JAILBREAK', categoryColor: C.tertiary, categoryBg: 'rgba(167,139,250,0.1)', action: 'QUARANTINE', score: '0.74', scoreColor: C.tertiary },
  { time: '14:21:44:902', source: 'API_EXT_90', model: 'Llama 3', category: 'SENSITIVE_DATA', categoryColor: C.secondary, categoryBg: 'rgba(122,179,255,0.1)', action: 'REDACTED', score: '0.61', scoreColor: C.secondary },
];

const INITIAL_FEED = [
  { t: 'T+0.0s', icon: ShieldAlert, iconColor: C.error, text: '[FIREWALL] Intercepted adversarial payload from 192.168.1.104. Payload hash match: E99A2...', borderLeft: false },
  { t: 'T+2.4s', icon: Info, iconColor: C.secondary, text: '[CORE] Policy update synchronization complete across 14 edge clusters.', borderLeft: false },
  { t: 'T+5.1s', icon: BrainCircuit, iconColor: C.tertiary, text: '[ML_MONITOR] Potential novel jailbreak pattern detected. Routing to Sandbox for analysis.', borderLeft: true, borderColor: C.tertiary },
  { t: 'T+8.9s', icon: Shield, iconColor: C.secondary, text: '[WAF] L7 SQLi filter triggered on LLM input buffer. Request dropped.', borderLeft: false },
];

const LIVE_LOGS = [
  { icon: ShieldAlert, color: C.error, text: '[FIREWALL] High entropy detected in query buffer. Probable token smuggling.' },
  { icon: Info, color: C.secondary, text: '[SYSTEM] Auth handshake successful for Node-B7.' },
  { icon: BrainCircuit, color: C.tertiary, text: '[GUARD] Semantic outlier detected in prompt cluster. Tagging for human review.' },
];

function MiniBar({ heights, color }) {
  return (
    <div style={{ height: '64px', display: 'flex', alignItems: 'flex-end', gap: '4px', marginBottom: '12px' }}>
      {heights.map((h, i) => (
        <div key={i} style={{ flex: 1, height: h, background: color, borderRadius: '4px 4px 0 0' }} />
      ))}
    </div>
  );
}

export default function AiFirewall() {
  const [feed, setFeed] = useState(INITIAL_FEED);

  useEffect(() => {
    const interval = setInterval(() => {
      const log = LIVE_LOGS[Math.floor(Math.random() * LIVE_LOGS.length)];
      const t = `T+${(Math.random() * 10).toFixed(1)}s`;
      setFeed(prev => [{ t, icon: log.icon, iconColor: log.color, text: log.text, borderLeft: false }, ...prev.slice(0, 19)]);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', height: '100%' }}>
      {/* Header Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px' }}>
        {[
          { label: 'Total Intercepts', value: '1.2M', sub: '↑ 12%', subColor: C.secondary },
          { label: 'Threat Level', value: 'CRITICAL', valueColor: C.error, pulse: true },
          { label: 'System Latency', value: '14ms', sub: 'STABLE', subColor: C.secondary },
          { label: 'Uptime', value: '99.998%', icon: ShieldCheck, iconColor: '#22d07a' },
        ].map((stat, i) => (
          <div key={i} className="glass" style={{ borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span className="font-mono" style={{ fontSize: '11px', color: C.onSurfaceV, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>{stat.label}</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <span className="font-display" style={{ fontSize: '28px', fontWeight: 700, color: stat.valueColor || C.onSurface }}>{stat.value}</span>
              {stat.sub && <span className="font-mono" style={{ fontSize: '12px', color: stat.subColor, fontWeight: 600 }}>{stat.sub}</span>}
              {stat.pulse && <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: C.error, display: 'inline-block', animation: 'pulse-dot 1.5s infinite', boxShadow: `0 0 12px ${C.error}` }} />}
              {stat.icon && <stat.icon size={24} color={stat.iconColor} />}
            </div>
          </div>
        ))}
      </div>

      {/* Main content row */}
      <div style={{ display: 'flex', gap: '24px', flex: 1, overflow: 'hidden' }}>
        {/* Left: heatmap + table */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto', paddingRight: '8px' }} className="custom-scrollbar">
          
          {/* Global Attack Vectors Map */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
            <div className="glass" style={{ borderRadius: '16px', height: '320px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, padding: '24px', zIndex: 10 }}>
                <h3 className="font-display" style={{ fontSize: '18px', fontWeight: 600, color: C.onSurface, margin: '0 0 4px 0' }}>Global Attack Vectors</h3>
                <p className="font-mono" style={{ fontSize: '11px', color: C.onSurfaceV, margin: 0 }}>Real-time logical heatmap of firewall bypass attempts</p>
              </div>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 0%, rgba(79,142,255,0.05) 50%, transparent 100%)', backgroundSize: '100% 4px', pointerEvents: 'none', zIndex: 5 }} />
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDtABgpR3ESKC3-mmitUNw1cYSQQp3oEd5wMwWj_k2RLG24Yimu38mjaRZdb1DgTWZU7Q1YC-0AreO_b87-na3vrWbhU93JvppYkQndtMPdXC1CiGYpk_tObRUssy_WP3MypryK2NcgkymToPNDelC3iAmJNKHEjBWdQHYJa_TsG8SqBuWHXWgmg7yW3KzZ8YSvwKXRer5lo9D9CQc_vFR0AaAbRrjOaxc_-3lI9KZ6--wm6pWv9i0YfV1xFT5OUFTj-U04Gi9ClS8O"
                alt="Global Attack Heatmap"
                style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.8, filter: 'contrast(1.2)' }}
              />
              {[[50,33],[25,50],[67,75]].map(([top,left], i) => (
                <div key={i} style={{ position: 'absolute', top: `${top}%`, left: `${left}%`, width: i === 2 ? '24px' : '16px', height: i === 2 ? '24px' : '16px', backgroundColor: C.error, borderRadius: '50%', animation: 'pulse-dot 1.5s infinite', zIndex: 10, boxShadow: `0 0 16px ${C.error}` }} />
              ))}
            </div>

            {/* Detection Summary Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {[
                { title: 'Prompt Injection', tag: 'HIGH RISK', tagColor: C.error, tagBg: 'rgba(255,79,79,0.1)', borderColor: C.error, heights: ['20%','40%','35%','80%','60%','95%'], barColor: `linear-gradient(to top, rgba(255,79,79,0.2), rgba(255,79,79,0.8))`, desc: 'Recent surge in indirect injection via RSS feeds.' },
                { title: 'Jailbreak Attempts', tag: 'MEDIUM RISK', tagColor: C.tertiary, tagBg: 'rgba(167,139,250,0.1)', borderColor: C.tertiary, heights: ['30%','50%','45%','40%','20%','15%'], barColor: `linear-gradient(to top, rgba(167,139,250,0.1), rgba(167,139,250,0.5))`, desc: 'Detected 42 recurring DAN-variant patterns.' },
                { title: 'Data Leakage', tag: 'MONITORING', tagColor: C.secondary, tagBg: 'rgba(122,179,255,0.1)', borderColor: C.secondary, heights: ['10%','12%','10%','15%','12%','10%'], barColor: `linear-gradient(to top, rgba(122,179,255,0.1), rgba(122,179,255,0.5))`, desc: 'PII filters active. No significant egress detected.' },
              ].map((card, i) => (
                <div key={i} className="glass" style={{ borderRadius: '16px', padding: '16px', borderLeft: `3px solid ${card.borderColor}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span className="font-display" style={{ fontSize: '14px', fontWeight: 600, color: C.onSurface }}>{card.title}</span>
                    <span className="font-mono" style={{ fontSize: '10px', fontWeight: 700, color: card.tagColor, backgroundColor: card.tagBg, padding: '2px 8px', borderRadius: '4px' }}>{card.tag}</span>
                  </div>
                  <MiniBar heights={card.heights.map((h, j) => h.includes('80') || h.includes('95') ? h : h)} color={card.barColor} />
                  <p className="font-mono" style={{ fontSize: '11px', color: C.onSurfaceV, margin: 0 }}>{card.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Blocked Requests Table */}
          <div className="glass" style={{ borderRadius: '16px', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.outline}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="font-display" style={{ fontSize: '16px', fontWeight: 600, color: C.onSurface, margin: 0 }}>Blocked Requests Log</h3>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.outline}` }}>
                  {['Timestamp', 'Source ID', 'Model', 'Threat Category', 'Action Taken', 'Score'].map(h => (
                    <th key={h} className="font-mono" style={{ padding: '12px 24px', textAlign: 'left', fontSize: '10px', fontWeight: 600, color: C.onSurfaceV, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BLOCKED.map((row, i) => (
                  <tr key={i} className="row-hover" style={{ borderBottom: `1px solid ${C.outline}`, cursor: 'pointer' }}>
                    <td className="font-mono" style={{ padding: '16px 24px', color: C.onSurfaceV, fontSize: '12px' }}>{row.time}</td>
                    <td className="font-mono" style={{ padding: '16px 24px', color: C.secondary, fontSize: '12px', fontWeight: 600 }}>{row.source}</td>
                    <td className="font-display" style={{ padding: '16px 24px', color: C.onSurface, fontSize: '13px' }}>{row.model}</td>
                    <td style={{ padding: '16px 24px' }}>
                      <span className="font-mono" style={{ padding: '4px 8px', borderRadius: '6px', backgroundColor: row.categoryBg, color: row.categoryColor, fontSize: '10px', fontWeight: 600 }}>{row.category}</span>
                    </td>
                    <td className="font-mono" style={{ padding: '16px 24px', color: C.onSurface, fontSize: '12px' }}>{row.action}</td>
                    <td className="font-mono" style={{ padding: '16px 24px', fontWeight: 600, color: row.scoreColor, fontSize: '13px' }}>{row.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Live Threat Feed */}
        <div className="glass-strong" style={{ width: '360px', display: 'flex', flexDirection: 'column', borderRadius: '16px', flexShrink: 0, overflow: 'hidden' }}>
          <div style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.outline}` }}>
            <h4 className="font-display" style={{ fontSize: '16px', fontWeight: 600, color: C.onSurface, margin: 0 }}>Live Threat Feed</h4>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: C.error, display: 'inline-block', animation: 'pulse-dot 1.5s infinite', boxShadow: `0 0 12px ${C.error}` }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }} className="custom-scrollbar">
            {feed.map((item, i) => (
              <div key={i} className="glass" style={{
                padding: '16px', borderRadius: '12px',
                borderLeft: `3px solid ${item.borderColor || 'transparent'}`,
                animation: i === 0 ? 'slide-up 0.4s ease' : 'none'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span className="font-mono" style={{ fontSize: '11px', color: C.onSurfaceV }}>{item.t}</span>
                  <item.icon size={16} color={item.iconColor} />
                </div>
                <p className="font-mono" style={{ fontSize: '12px', lineHeight: 1.6, color: C.onSurface, margin: 0 }}>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
