'use client';

import { useEffect, useMemo, useState } from 'react';
import { Panel } from '@/components/gov/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { BankTool, FleetCap, FleetCaps, FleetRateLimit, FleetRateLimits } from '@/lib/types';
import { Globe, Plus, Trash2, Save, Loader2, AlertCircle, CheckCircle2, Gauge } from 'lucide-react';

const WINDOWS: { value: FleetCap['window']; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'monthly', label: 'Monthly' },
];

// A fleet cap is a platform-wide spend ceiling on a single tool parameter,
// shared by every agent in the fleet (single shared Redis counter per tool+param).
export function FleetCapsView({ onRefresh }: { onRefresh?: () => void }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('settings:update');

  const [tools, setTools] = useState<BankTool[]>([]);
  const [caps, setCaps] = useState<FleetCaps>({});
  const [rateLimits, setRateLimits] = useState<FleetRateLimits>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [saved, setSaved] = useState(false);

  // Draft row state for the "add cap" form.
  const [draftTool, setDraftTool] = useState('');
  const [draftParam, setDraftParam] = useState('');
  const [draftWindow, setDraftWindow] = useState<FleetCap['window']>('daily');
  const [draftLimit, setDraftLimit] = useState('');

  // Draft row state for the "add rate limit" form.
  const [rlTool, setRlTool] = useState('');
  const [rlMaxCalls, setRlMaxCalls] = useState('');
  const [rlWindowSec, setRlWindowSec] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getAllTools(), api.getFleetCaps()])
      .then(([toolList, capsRes]) => {
        if (cancelled) return;
        setTools(toolList);
        setCaps(capsRes.caps || {});
        setRateLimits(capsRes.rate_limits || {});
        if (toolList.length > 0) {
          setDraftTool(toolList[0].name);
          setRlTool(toolList[0].name);
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Failed to load fleet caps');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const draftToolMeta = useMemo(
    () => tools.find((t) => t.name === draftTool),
    [tools, draftTool]
  );
  const numericParams = useMemo(() => {
    const schema = (draftToolMeta?.input_schema || {}) as Record<string, any>;
    const props = (schema.properties || {}) as Record<string, any>;
    return Object.entries(props)
      .filter(([, def]) => {
        const type = (def && (def as any).type) || '';
        return type === 'number' || type === 'integer';
      })
      .map(([name]) => name);
  }, [draftToolMeta]);

  useEffect(() => {
    if (draftParam && !numericParams.includes(draftParam)) setDraftParam('');
  }, [numericParams, draftParam]);

  const handleAdd = () => {
    if (!draftTool || !draftParam || !draftLimit.trim()) return;
    // *_cents params are already in cents (no ×100); major-unit params are
    // dollars and must be converted to cents. Matches the gateway convention.
    const isCentsParam = draftParam.endsWith('_cents');
    const cents = Math.max(0, Math.round((parseFloat(draftLimit) || 0) * (isCentsParam ? 1 : 100)));
    if (cents <= 0) return;

    const next: FleetCaps = { ...caps };
    const existing = (next[draftTool] || []).filter(
      (c) => !(c.param === draftParam && c.window === draftWindow)
    );
    existing.push({ param: draftParam, window: draftWindow, limit_cents: cents });
    next[draftTool] = existing;
    setCaps(next);
    setDraftLimit('');
    setSaved(false);
  };

  const handleRemove = (tool: string, param: string, window: FleetCap['window']) => {
    const next: FleetCaps = { ...caps };
    const remaining = (next[tool] || []).filter(
      (c) => !(c.param === param && c.window === window)
    );
    if (remaining.length > 0) next[tool] = remaining;
    else delete next[tool];
    setCaps(next);
    setSaved(false);
  };

  const handleAddRateLimit = () => {
    if (!rlTool || !rlMaxCalls.trim() || !rlWindowSec.trim()) return;
    const maxCalls = Math.max(1, Math.round(parseFloat(rlMaxCalls) || 0));
    const windowSec = Math.max(1, Math.round(parseFloat(rlWindowSec) || 0));
    if (maxCalls <= 0 || windowSec <= 0) return;

    const next: FleetRateLimits = { ...rateLimits };
    const existing = (next[rlTool] || []).filter(
      (r) => !(r.max_calls === maxCalls && r.window_seconds === windowSec)
    );
    existing.push({ max_calls: maxCalls, window_seconds: windowSec });
    next[rlTool] = existing;
    setRateLimits(next);
    setRlMaxCalls('');
    setRlWindowSec('');
    setSaved(false);
  };

  const handleRemoveRateLimit = (tool: string, maxCalls: number, windowSec: number) => {
    const next: FleetRateLimits = { ...rateLimits };
    const remaining = (next[tool] || []).filter(
      (r) => !(r.max_calls === maxCalls && r.window_seconds === windowSec)
    );
    if (remaining.length > 0) next[tool] = remaining;
    else delete next[tool];
    setRateLimits(next);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await api.updateFleetCaps(caps, rateLimits);
      setSaved(true);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to save fleet caps');
    } finally {
      setSaving(false);
    }
  };

  const totalCaps = Object.values(caps).reduce((n, arr) => n + arr.length, 0);
  const totalRateLimits = Object.values(rateLimits).reduce((n, arr) => n + arr.length, 0);

  // Format a seconds window into a human-readable label (e.g. 3600 -> "1h").
  const fmtWindow = (sec: number) => {
    if (sec % 86400 === 0) return `${sec / 86400}d`;
    if (sec % 3600 === 0) return `${sec / 3600}h`;
    if (sec % 60 === 0) return `${sec / 60}m`;
    return `${sec}s`;
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="font-mono text-sm uppercase tracking-widest text-ink-primary font-semibold">
          Fleet Caps &amp; Rate Limits
        </h2>
        <p className="font-sans text-xs text-ink-secondary">
          Platform-wide governance shared by every agent in the fleet. Spend caps set a global
          ceiling on a tool parameter; rate limits cap how many calls all agents can make to a
          tool within a rolling window. Each is enforced with a single shared counter — a true
          global limit, not per-class.
        </p>
      </div>

      {!canEdit && (
        <div className="flex items-center gap-2 border border-amber-500/30 bg-amber-500/10 p-3 rounded font-mono text-xs text-amber-300">
          <AlertCircle className="h-4 w-4" />
          Read-only: only Platform Administrators can modify fleet caps.
        </div>
      )}

      <Panel title="Configured Fleet Caps">
        {loading ? (
          <div className="flex items-center gap-2 p-4 font-mono text-xs text-ink-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading fleet caps…
          </div>
        ) : totalCaps === 0 ? (
          <div className="p-4 font-mono text-xs text-ink-secondary/70">
            No fleet caps configured yet. Add one below to set a platform-wide spend ceiling.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {Object.entries(caps).map(([tool, entries]) => (
              <div key={tool} className="p-3">
                <div className="flex items-center gap-2 font-mono text-xs text-cyan-400 font-bold">
                  <Globe className="h-3.5 w-3.5" /> {tool}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {entries.map((c) => (
                    <div
                      key={`${c.param}-${c.window}`}
                      className="flex items-center gap-1.5 border border-white/10 bg-slate-950 px-2 py-1 rounded font-mono text-[11px]"
                    >
                      <span className="text-amber-300 font-semibold uppercase">{c.window}:</span>
                      <span className="text-white">{c.param}</span>
                      <span className="text-cyan-300 font-bold">
                        ≤ ${(c.limit_cents / 100).toLocaleString()}
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleRemove(tool, c.param, c.window)}
                          className="text-rose-400 hover:text-rose-300 cursor-pointer ml-0.5"
                          title="Remove this fleet cap"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {canEdit && (
        <Panel title="Add Fleet Cap">
          <div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-4">
            <div>
              <Label className="font-mono text-[10px] text-ink-secondary">Tool</Label>
              <select
                value={draftTool}
                onChange={(e) => setDraftTool(e.target.value)}
                className="mt-1 h-8 w-full border border-white/10 bg-slate-900 px-2 font-mono text-xs text-white rounded"
              >
                {tools.length > 0 ? (
                  tools.map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))
                ) : (
                  <option value="">No tools registered</option>
                )}
              </select>
            </div>

            <div>
              <Label className="font-mono text-[10px] text-ink-secondary">Parameter</Label>
              <select
                value={draftParam}
                onChange={(e) => setDraftParam(e.target.value)}
                disabled={numericParams.length === 0}
                className="mt-1 h-8 w-full border border-white/10 bg-slate-900 px-2 font-mono text-xs text-white rounded disabled:opacity-50"
              >
                <option value="">
                  {!draftToolMeta
                    ? 'Tool not registered'
                    : numericParams.length === 0
                      ? 'No numeric params in schema'
                      : 'Select a parameter to cap'}
                </option>
                {numericParams.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <Label className="font-mono text-[10px] text-ink-secondary">Window</Label>
              <select
                value={draftWindow}
                onChange={(e) => setDraftWindow(e.target.value as FleetCap['window'])}
                className="mt-1 h-8 w-full border border-white/10 bg-slate-900 px-2 font-mono text-xs text-white rounded"
              >
                {WINDOWS.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label className="font-mono text-[10px] text-ink-secondary">Cap Limit ($)</Label>
              <Input
                type="number"
                value={draftLimit}
                onChange={(e) => setDraftLimit(e.target.value)}
                placeholder="e.g. 50000"
                className="mt-1 h-8 border-white/10 bg-slate-900 font-mono text-xs text-white"
              />
            </div>
          </div>

          <div className="px-4 pb-4">
            <Button
              type="button"
              onClick={handleAdd}
              disabled={!draftTool || !draftParam || !draftLimit.trim()}
              className="h-8 border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 font-mono text-xs disabled:opacity-40"
            >
              <Plus className="h-3 w-3 mr-1" /> Add Cap
            </Button>
          </div>
        </Panel>
      )}

      <Panel title="Configured Fleet Rate Limits">
        {loading ? (
          <div className="flex items-center gap-2 p-4 font-mono text-xs text-ink-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading fleet rate limits…
          </div>
        ) : totalRateLimits === 0 ? (
          <div className="p-4 font-mono text-xs text-ink-secondary/70">
            No fleet rate limits configured yet. Add one below to cap how many calls every agent
            in the fleet can make to a tool within a rolling window.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {Object.entries(rateLimits).map(([tool, entries]) => (
              <div key={tool} className="p-3">
                <div className="flex items-center gap-2 font-mono text-xs text-cyan-400 font-bold">
                  <Gauge className="h-3.5 w-3.5" /> {tool}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {entries.map((r, i) => (
                    <div
                      key={`${r.max_calls}-${r.window_seconds}-${i}`}
                      className="flex items-center gap-1.5 border border-white/10 bg-slate-950 px-2 py-1 rounded font-mono text-[11px]"
                    >
                      <span className="text-violet-300 font-semibold uppercase">every {fmtWindow(r.window_seconds)}:</span>
                      <span className="text-white">≤ {r.max_calls.toLocaleString()} calls</span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleRemoveRateLimit(tool, r.max_calls, r.window_seconds)}
                          className="text-rose-400 hover:text-rose-300 cursor-pointer ml-0.5"
                          title="Remove this fleet rate limit"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {canEdit && (
        <Panel title="Add Fleet Rate Limit">
          <div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-3">
            <div>
              <Label className="font-mono text-[10px] text-ink-secondary">Tool</Label>
              <select
                value={rlTool}
                onChange={(e) => setRlTool(e.target.value)}
                className="mt-1 h-8 w-full border border-white/10 bg-slate-900 px-2 font-mono text-xs text-white rounded"
              >
                {tools.length > 0 ? (
                  tools.map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))
                ) : (
                  <option value="">No tools registered</option>
                )}
              </select>
            </div>

            <div>
              <Label className="font-mono text-[10px] text-ink-secondary">Max Calls</Label>
              <Input
                type="number"
                value={rlMaxCalls}
                onChange={(e) => setRlMaxCalls(e.target.value)}
                placeholder="e.g. 100"
                className="mt-1 h-8 border-white/10 bg-slate-900 font-mono text-xs text-white"
              />
            </div>

            <div>
              <Label className="font-mono text-[10px] text-ink-secondary">Window (seconds)</Label>
              <Input
                type="number"
                value={rlWindowSec}
                onChange={(e) => setRlWindowSec(e.target.value)}
                placeholder="e.g. 3600"
                className="mt-1 h-8 border-white/10 bg-slate-900 font-mono text-xs text-white"
              />
            </div>
          </div>

          <div className="px-4 pb-4">
            <Button
              type="button"
              onClick={handleAddRateLimit}
              disabled={!rlTool || !rlMaxCalls.trim() || !rlWindowSec.trim()}
              className="h-8 border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 font-mono text-xs disabled:opacity-40"
            >
              <Plus className="h-3 w-3 mr-1" /> Add Rate Limit
            </Button>
          </div>
        </Panel>
      )}

      {error && (
        <div className="flex items-center gap-2 border border-rose-500/30 bg-rose-500/10 p-3 rounded font-mono text-xs text-rose-300">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-9 border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 font-mono text-xs disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            {saving ? 'Saving…' : 'Save Fleet Caps'}
          </Button>
          {saved && (
            <span className="flex items-center gap-1 font-mono text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved & propagated to all agents
            </span>
          )}
        </div>
      )}
    </div>
  );
}
