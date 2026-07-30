'use client';

import { useEffect, useState } from 'react';
import { Panel } from '@/components/gov/panel';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { User, Mail, Shield, Server, Database, CheckCircle2, XCircle, Cpu } from 'lucide-react';

type SystemHealth = { gateway: string; redis: string; opa: string; database: string };

function EngineStatus({ status }: { status?: string }) {
  if (!status) {
    return (
      <span className="font-mono text-[10px] uppercase text-ink-secondary font-semibold">Checking…</span>
    );
  }
  const down = status === 'unreachable';
  return (
    <span
      className={`flex items-center gap-1 font-mono text-[10px] uppercase font-semibold ${
        down ? 'text-signal-stopped' : 'text-signal-healthy'
      }`}
    >
      {down ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      {status}
    </span>
  );
}

export function SettingsView({ operator }: { operator: string }) {
  const [health, setHealth] = useState<SystemHealth | null>(null);

  // Engine badges reflect live probes (DB ping, Redis ping, gateway /health),
  // refreshed while the view is open — never static text.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.getSystemHealth().then((h) => {
        if (!cancelled) setHealth(h);
      }).catch(() => {
        if (!cancelled) setHealth({ gateway: 'unreachable', redis: 'unreachable', opa: 'unreachable', database: 'unreachable' });
      });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="font-mono text-sm uppercase tracking-widest text-ink-primary font-semibold">
          Platform Settings & Engine Health
        </h2>
        <p className="font-sans text-xs text-ink-secondary">
          Platform architecture state, compliance operator identity, and security failure mode configurations.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Compliance Operator Profile */}
        <Panel title="Compliance Operator Profile">
          <div className="space-y-4 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center border border-accent/30 bg-accent/10">
                <User className="h-6 w-6 text-accent" />
              </div>
              <div>
                <div className="font-mono text-sm text-ink-primary font-semibold">{operator}</div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                  Chief Compliance & Security Officer
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t border-white/5 pt-3">
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                  Authenticated Email
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-ink-secondary" />
                  <span className="font-mono text-xs text-ink-primary">{operator}@bank.example</span>
                </div>
              </div>

              <div>
                <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                  RBAC Role & Authority
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-signal-healthy" />
                  <span className="font-mono text-xs text-signal-healthy font-semibold">Full Governance Authority (Fleet Revocation & Policy Authoring)</span>
                </div>
              </div>
            </div>
          </div>
        </Panel>

        {/* Platform Architecture & Engine Status */}
        <Panel title="Governance Infrastructure & Engine Status">
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between border border-border bg-slate-950 p-3">
              <div className="flex items-center gap-2.5">
                <Server className="h-4 w-4 text-accent" />
                <div>
                  <div className="font-mono text-xs text-ink-primary font-medium">AGP Gateway Proxy Engine</div>
                  <div className="font-mono text-[10px] text-ink-secondary">Go Interceptor</div>
                </div>
              </div>
              <EngineStatus status={health?.gateway} />
            </div>

            <div className="flex items-center justify-between border border-border bg-slate-950 p-3">
              <div className="flex items-center gap-2.5">
                <Database className="h-4 w-4 text-accent" />
                <div>
                  <div className="font-mono text-xs text-ink-primary font-medium">Redis Killswitch & State Cache</div>
                  <div className="font-mono text-[10px] text-ink-secondary">Pub/Sub Real-time Synced</div>
                </div>
              </div>
              <EngineStatus status={health?.redis} />
            </div>

            <div className="flex items-center justify-between border border-border bg-slate-950 p-3">
              <div className="flex items-center gap-2.5">
                <Cpu className="h-4 w-4 text-accent" />
                <div>
                  <div className="font-mono text-xs text-ink-primary font-medium">Open Policy Agent (OPA)</div>
                  <div className="font-mono text-[10px] text-ink-secondary">Embedded Rego Evaluator</div>
                </div>
              </div>
              <EngineStatus status={health?.opa} />
            </div>
          </div>
        </Panel>

        {/* Global Security & Failure Mode Defaults */}
        <Panel title="Platform Security & Failure Mode Defaults" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-3">
            <div className="border border-white/5 bg-slate-950 p-3">
              <div className="font-mono text-xs text-ink-primary font-semibold">Default Failure Mode</div>
              <div className="mt-1 font-mono text-[11px] text-signal-stopped font-bold uppercase">FAIL-CLOSED (Strict Security)</div>
              <p className="mt-1 font-sans text-[11px] text-ink-secondary">
                If an upstream service times out or errors out, the Gateway defaults to denying execution.
              </p>
            </div>

            <div className="border border-white/5 bg-slate-950 p-3">
              <div className="font-mono text-xs text-ink-primary font-semibold">Audit Chain Security</div>
              <div className="mt-1 font-mono text-[11px] text-signal-healthy font-bold uppercase">SHA-256 Hash Chained</div>
              <p className="mt-1 font-sans text-[11px] text-ink-secondary">
                Every audit record is cryptographically signed with previous entry hashes to prevent database tampering.
              </p>
            </div>

            <div className="border border-white/5 bg-slate-950 p-3">
              <div className="font-mono text-xs text-ink-primary font-semibold">Killswitch Propagation</div>
              <div className="mt-1 font-mono text-[11px] text-accent font-bold uppercase">Redis Pub/Sub Fan-out</div>
              <p className="mt-1 font-sans text-[11px] text-ink-secondary">
                Emergency agent revocations propagate instantly across Gateway nodes via Redis Pub/Sub.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
