'use client';

import { useState, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Panel } from '@/components/gov/panel';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDateTime, formatTimestamp } from '@/lib/format';
import type { AuditLogEntry } from '@/lib/types';
import { api } from '@/lib/api';
import { Search, Download, Lock, ArrowRight, ShieldCheck, AlertTriangle, AlertCircle } from 'lucide-react';

const entryTypeLabel: Record<string, string> = {
  action: 'Action',
  config_change: 'Config Change',
  policy_change: 'Policy Change',
  stop_event: 'Stop Event',
};

const entryTypeColor: Record<string, string> = {
  action: 'text-ink-secondary',
  config_change: 'text-accent',
  policy_change: 'text-accent',
  stop_event: 'text-signal-stopped',
};

export function AuditLogView({ entries }: { entries: AuditLogEntry[] }) {
  const [activeTab, setActiveTab] = useState<'tools' | 'system'>('tools');
  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [exportError, setExportError] = useState('');

  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  const [loadingSystem, setLoadingSystem] = useState(false);

  useEffect(() => {
    if (activeTab === 'system') {
      setLoadingSystem(true);
      api.getSystemAuditLog()
        .then(setSystemLogs)
        .catch((err) => console.error('Failed to load system audit log:', err))
        .finally(() => setLoadingSystem(false));
    }
  }, [activeTab]);

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    total_records: number;
    verified_until_id: number;
    error_message?: string;
  } | null>(null);

  const handleVerifyIntegrity = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await api.verifyAuditLog();
      setVerifyResult(res);
    } catch (err: any) {
      setVerifyResult({
        valid: false,
        total_records: entries.length,
        verified_until_id: 0,
        error_message: err.message || 'Verification call failed',
      });
    } finally {
      setVerifying(false);
    }
  };

  // The backend integrity error names a specific record, e.g.
  // "Hash chain mismatch at row ID 42: ...". Extract that ID so we can point
  // the operator at the exact row in the table below.
  const failedRecordId = useMemo(() => {
    if (!verifyResult || verifyResult.valid) return null;
    const m = verifyResult.error_message?.match(/row ID (\d+)/i);
    return m ? m[1] : null;
  }, [verifyResult]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !e.agentId.toLowerCase().includes(q) &&
          !e.action.toLowerCase().includes(q) &&
          !(e.reason ?? '').toLowerCase().includes(q) &&
          !(e.operator ?? '').toLowerCase().includes(q)
        )
          return false;
      }
      if (outcomeFilter !== 'all' && e.decision !== outcomeFilter) return false;
      return true;
    });
  }, [entries, search, outcomeFilter]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-ink-primary font-semibold">
            Audit Log & Cryptographic Verification
          </h2>
          <p className="font-sans text-xs text-ink-secondary">
            Immutable, SHA-256 hash-chained historical record of all tool calls, governance decisions, and system events.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={handleVerifyIntegrity}
            disabled={verifying}
            className="border border-signal-healthy/40 bg-signal-healthy/10 text-signal-healthy hover:bg-signal-healthy/20 font-mono text-xs"
          >
            <ShieldCheck className="mr-1.5 h-4 w-4" />
            {verifying ? 'Verifying Hashes...' : 'Verify Audit Chain Integrity'}
          </Button>

          <div className="flex items-center gap-2">
            {/* Server-side export: full audit log (up to 5000 rows), properly
                CSV-escaped by the backend — not limited to on-screen rows. */}
            <Button
              onClick={async () => {
                setExportError('');
                try {
                  await api.exportAuditLogCsv();
                } catch (err: any) {
                  setExportError(err.message || 'Export failed');
                }
              }}
              variant="outline"
              className="border-border text-ink-secondary hover:bg-white/5 font-mono text-xs"
            >
              <Download className="mr-1.5 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>
      </div>

      {exportError && (
        <div className="flex items-center gap-2 border border-signal-stopped/30 bg-signal-stopped/10 p-2.5 rounded font-mono text-xs text-signal-stopped">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Export failed: {exportError}</span>
          <button onClick={() => setExportError('')} className="ml-auto text-signal-stopped/60 hover:text-signal-stopped">×</button>
        </div>
      )}

      {/* Sub-Tab Selection: Agent Tool Calls vs System & Admin Operations */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] pb-2">
        <button
          onClick={() => setActiveTab('tools')}
          className={cn(
            'px-3 py-1.5 font-mono text-xs rounded transition-colors cursor-pointer',
            activeTab === 'tools'
              ? 'bg-accent/15 text-accent border border-accent/30 font-bold'
              : 'text-ink-secondary hover:text-ink-primary hover:bg-white/5'
          )}
        >
          Agent Tool Calls (SHA-256 Chained)
        </button>
        <button
          onClick={() => setActiveTab('system')}
          className={cn(
            'px-3 py-1.5 font-mono text-xs rounded transition-colors cursor-pointer',
            activeTab === 'system'
              ? 'bg-accent/15 text-accent border border-accent/30 font-bold'
              : 'text-ink-secondary hover:text-ink-primary hover:bg-white/5'
          )}
        >
          System & Admin Operations Trail
        </button>
      </div>

      {activeTab === 'tools' ? (
        <>
          {/* Verification Result Banner */}
          {verifyResult && (
            <div
              className={cn(
                'flex items-center justify-between border p-3 font-mono text-xs',
                verifyResult.valid
                  ? 'border-signal-healthy/40 bg-signal-healthy/10 text-signal-healthy'
                  : 'border-signal-stopped/40 bg-signal-stopped/10 text-signal-stopped'
              )}
            >
              <div className="flex items-center gap-2">
                {verifyResult.valid ? (
                  <ShieldCheck className="h-5 w-5 shrink-0 text-signal-healthy" />
                ) : (
                  <AlertTriangle className="h-5 w-5 shrink-0 text-signal-stopped" />
                )}
                <div>
                  <div className="font-bold uppercase tracking-wider">
                    {verifyResult.valid
                      ? 'Cryptographic Audit Chain Intact — 0 Tampered Records'
                      : 'AUDIT LOG INTEGRITY FAILURE DETECTED'}
                  </div>
                  <div className="text-[11px] opacity-90">
                    {verifyResult.valid
                      ? `Successfully validated SHA-256 hash signatures across all ${verifyResult.total_records} database records.`
                      : verifyResult.error_message || 'Database records have been tampered with or modified.'}
                  </div>
                  {!verifyResult.valid && failedRecordId && (
                    <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-wider">
                      First broken record: #{failedRecordId} — highlighted in the table below.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
              <Input
                placeholder="Search agent, action, operator, reason…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="border-white/[0.06] bg-white/[0.02] pl-9 font-mono text-sm placeholder:text-ink-secondary/50"
              />
            </div>
            <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
              <SelectTrigger className="w-[120px] border-white/[0.06] bg-white/[0.02] font-mono text-xs">
                <SelectValue placeholder="Outcome" />
              </SelectTrigger>
              <SelectContent className="border-border bg-slate-900 text-white">
                <SelectItem value="all">All outcomes</SelectItem>
                <SelectItem value="allow">Allow</SelectItem>
                <SelectItem value="deny">Deny</SelectItem>
              </SelectContent>
            </Select>
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
              {filtered.length} entries
            </span>
          </div>

          {/* Table */}
          <Panel>
            <div className="max-h-[calc(100vh-320px)] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-[rgba(14,20,28,0.9)] backdrop-blur-xl">
                  <tr className="border-b border-white/5">
                    {['ID', 'Timestamp', 'Agent', 'Action', 'Outcome', 'Reason / Change', 'Latency'].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-widest text-ink-secondary"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => (
                    <tr
                      key={entry.id}
                      className={cn(
                        'border-b border-white/5 transition-colors hover:bg-white/5',
                        failedRecordId &&
                          entry.id === failedRecordId &&
                          'bg-signal-stopped/10 ring-1 ring-inset ring-signal-stopped/50'
                      )}
                    >
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px] tabular text-ink-secondary/70">
                        #{entry.id}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px] text-ink-secondary tabular">
                        {formatTimestamp(entry.timestamp)}
                        <div className="text-[9px] text-ink-secondary/60">
                          {formatDateTime(entry.timestamp)}
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono text-[10px] text-accent font-medium">
                        {entry.agentId === '-' ? '—' : entry.agentId}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-primary font-semibold">
                        {entry.action}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={cn(
                            'font-mono text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-sm border',
                            entry.decision === 'allow'
                              ? 'bg-signal-healthy/10 text-signal-healthy border-signal-healthy/30'
                              : 'bg-signal-stopped/10 text-signal-stopped border-signal-stopped/30'
                          )}
                        >
                          {entry.decision}
                        </span>
                      </td>
                      <td className="max-w-[300px] px-4 py-2 font-sans text-[11px] text-ink-secondary">
                        {entry.reason}
                        {entry.oldValue && entry.newValue && (
                          <div className="mt-0.5 flex items-center gap-1 font-mono text-[10px]">
                            <span className="text-signal-stopped">{entry.oldValue}</span>
                            <ArrowRight className="h-3 w-3 text-ink-secondary" />
                            <span className="text-signal-healthy">{entry.newValue}</span>
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px] text-ink-secondary tabular">
                        {entry.latencyMs || entry.total_latency_ms ? `${entry.latencyMs || entry.total_latency_ms}ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="p-8 text-center font-mono text-xs text-ink-secondary">
                  No audit entries match the current filters.
                </div>
              )}
            </div>
          </Panel>
        </>
      ) : (
        /* System & Admin Operations Table */
        <Panel title="Administrative, Policy & System Event Log">
          <div className="max-h-[calc(100vh-280px)] overflow-auto">
            {loadingSystem ? (
              <div className="p-8 text-center font-mono text-xs text-ink-secondary">
                Loading administrative audit logs…
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-[rgba(14,20,28,0.9)] backdrop-blur-xl">
                  <tr className="border-b border-white/5">
                    {['ID', 'Timestamp', 'Operator / Actor', 'Action', 'Target Resource', 'Event Details'].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-widest text-ink-secondary"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {systemLogs.map((item) => (
                    <tr key={item.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px] tabular text-ink-secondary/70">
                        #{item.id}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px] text-ink-secondary tabular">
                        {item.created_at ? formatDateTime(item.created_at) : '—'}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-accent font-medium">
                        {item.actor_email || item.actor_id}
                      </td>
                      <td className="px-4 py-2">
                        <span className="font-mono text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-sm border border-accent/30 bg-accent/10 text-accent">
                          {item.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-primary">
                        {item.target_email || item.target_id || '—'}
                      </td>
                      <td className="max-w-[300px] px-4 py-2 font-mono text-[10px] text-ink-secondary">
                        {item.details && typeof item.details === 'object' && Object.keys(item.details).length > 0 ? (
                          <div className="space-y-0.5">
                            {Object.entries(item.details).map(([k, v]) => (
                              <div key={k} className="flex gap-1.5">
                                <span className="text-ink-secondary/70 shrink-0">{k}:</span>
                                <span className="text-ink-primary truncate">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-ink-secondary/50">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!loadingSystem && systemLogs.length === 0 && (
              <div className="p-8 text-center font-mono text-xs text-ink-secondary">
                No system or admin operation logs recorded yet.
              </div>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
