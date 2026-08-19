'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Panel } from '@/components/gov/panel';
import { StatusBadge } from '@/components/gov/status-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { BankConnection } from '@/lib/types';
import { formatRelative } from '@/lib/format';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Plus, Check, RefreshCw, Server, AlertCircle, FileUp, Link2, Plug, Loader2, Trash2, Eye, Pencil } from 'lucide-react';

const sourceTypeLabel: Record<string, string> = {
  native_mcp: 'Native MCP',
  openapi: 'OpenAPI Virtualized',
  manual: 'Manual',
};

export function BankConnectionsView({
  connections,
  isLoading = false,
  onRefresh,
}: {
  connections: BankConnection[];
  isLoading?: boolean;
  onRefresh?: () => void;
}) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('bank:create');
  const canUpdate = hasPermission('bank:update');
  const canDelete = hasPermission('bank:delete');
  const canProbe = hasPermission('bank:probe');

  const [showWizard, setShowWizard] = useState(false);
  const [editingConn, setEditingConn] = useState<BankConnection | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      await api.syncBankConnection(id);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      alert(`Failed to re-sync connection: ${err.message || 'Unknown error'}`);
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-ink-primary">
            Bank Connections & MCP Servers
          </h2>
          <p className="font-sans text-xs text-ink-secondary">
            Manage connected financial APIs and Model Context Protocol tool servers.
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => setShowWizard(true)}
            className="border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add connection
          </Button>
        )}
      </div>

      {connections.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {connections.map((conn) => (
            <Panel key={conn.id}>
              <div className="flex items-start justify-between gap-3 border-b border-white/5 p-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-white/10 bg-white/5 font-mono text-xs font-bold text-accent">
                    <Server className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-semibold text-ink-primary">
                      {conn.name}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-ink-secondary">
                      <span>{conn.sourceType === 'native_mcp' ? 'Native MCP' : 'OpenAPI Proxy'}</span>
                      <span>·</span>
                      <span>{conn.toolCount || (conn.tools ? conn.tools.length : 0)} tools</span>
                      {conn.sourceType === 'native_mcp' && (
                        <>
                          <span>·</span>
                          <span>{conn.resourceCount || (conn.resources ? conn.resources.length : 0)} resources</span>
                          <span>·</span>
                          <span>{conn.promptCount || (conn.prompts ? conn.prompts.length : 0)} prompts</span>
                        </>
                      )}
                      {conn.lastSync && (
                        <>
                          <span>·</span>
                          <span>synced {formatRelative(conn.lastSync)}</span>
                        </>
                      )}
                    </div>
                    {conn.mcpUrl && (
                      <div className="mt-1 font-mono text-[11px] text-ink-secondary/70 truncate max-w-sm">
                        {conn.mcpUrl}
                      </div>
                    )}
                    {conn.baseUrl && !conn.mcpUrl && (
                      <div className="mt-1 font-mono text-[11px] text-ink-secondary/70 truncate max-w-sm">
                        REST: {conn.baseUrl}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canUpdate && (
                    <button
                      onClick={() => setEditingConn(conn)}
                      className="flex h-7 w-7 items-center justify-center rounded border border-white/10 bg-white/5 text-ink-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent cursor-pointer"
                      title="Edit connection — update URL, credentials, or auth type"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {canProbe && (
                    <button
                      disabled={syncingId === conn.id}
                      onClick={() => handleSync(conn.id)}
                      className="flex h-7 w-7 items-center justify-center rounded border border-white/10 bg-white/5 text-ink-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent cursor-pointer disabled:opacity-50"
                      title="Reload — re-probe the server and re-discover tools & status"
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', syncingId === conn.id && 'animate-spin')} />
                    </button>
                  )}
                  <StatusBadge status={conn.status} />
                </div>
              </div>

              {(conn.tools?.length ?? 0) > 0 ? (
                <div className="p-3">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary mb-2">
                    Exposed MCP Tools ({conn.tools?.filter((t) => t.exposed).length} / {conn.tools?.length})
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {conn.tools?.map((tool) => (
                      <div key={tool.id} className="flex items-center gap-2 border border-white/5 bg-white/[0.02] p-1.5 rounded">
                        <span className={cn('rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold', methodColor(tool.method || 'GET'))}>
                          {tool.method || 'MCP'}
                        </span>
                        <span className="font-mono text-xs text-ink-primary font-medium">{tool.name}</span>
                        <span className="truncate font-mono text-[10px] text-ink-secondary flex-1">{tool.path || tool.description}</span>
                        <button
                          onClick={async () => {
                            try {
                              await api.updateTool(Number(tool.id), { exposed: !tool.exposed });
                              if (onRefresh) onRefresh();
                            } catch (err: any) {
                              alert(`Failed to update tool: ${err.message || 'Unknown error'}`);
                            }
                          }}
                          className={cn(
                            'px-2 py-0.5 rounded font-mono text-[9px] uppercase tracking-wider transition-colors cursor-pointer',
                            tool.exposed
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-rose-500/20 hover:text-rose-400'
                              : 'bg-white/5 text-ink-secondary border border-white/10 hover:bg-emerald-500/20 hover:text-emerald-400'
                          )}
                          title={tool.exposed ? 'Click to disable tool' : 'Click to expose tool'}
                        >
                          {tool.exposed ? 'EXPOSED' : 'DISABLED'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center font-mono text-xs text-ink-secondary">
                  {conn.status === 'pending'
                    ? 'Awaiting configuration — complete setup to expose tools.'
                    : conn.status === 'error'
                    ? 'Upstream unreachable — check the server URL and re-sync.'
                    : 'No tools registered for this server.'}
                </div>
              )}

              {conn.sourceType === 'native_mcp' && (conn.resources?.length ?? 0) > 0 && (
                <div className="border-t border-white/5 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary mb-2">
                    MCP Resources ({conn.resources?.filter((r) => r.exposed).length} / {conn.resources?.length})
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {conn.resources?.map((res) => (
                      <div key={res.id} className="flex items-center gap-2 border border-white/5 bg-white/[0.02] p-1.5 rounded">
                        <span className="rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold bg-sky-500/15 text-sky-400">
                          RES
                        </span>
                        <span className="font-mono text-xs text-ink-primary font-medium">{res.name || res.uri}</span>
                        <span className="truncate font-mono text-[10px] text-ink-secondary flex-1">{res.uri}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {conn.sourceType === 'native_mcp' && (conn.prompts?.length ?? 0) > 0 && (
                <div className="border-t border-white/5 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary mb-2">
                    MCP Prompts ({conn.prompts?.filter((p) => p.exposed).length} / {conn.prompts?.length})
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {conn.prompts?.map((pr) => (
                      <div key={pr.id} className="flex items-center gap-2 border border-white/5 bg-white/[0.02] p-1.5 rounded">
                        <span className="rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold bg-violet-500/15 text-violet-400">
                          PROMPT
                        </span>
                        <span className="font-mono text-xs text-ink-primary font-medium">{pr.name}</span>
                        <span className="truncate font-mono text-[10px] text-ink-secondary flex-1">{pr.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end border-t border-white/5 p-2 bg-white/[0.01]">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 font-mono text-[10px] uppercase tracking-widest text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                    >
                      <Trash2 className="mr-1 h-3 w-3" /> Remove Server Connection
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="border-white/10 bg-slate-950 text-white">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="font-mono text-sm uppercase tracking-widest text-rose-400">
                        Remove Connection '{conn.name}'?
                      </AlertDialogTitle>
                      <AlertDialogDescription className="font-sans text-xs text-ink-secondary">
                        This will permanently remove this MCP connection registration and unregister all associated tools from the gateway proxy.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="border-white/10 bg-transparent text-ink-secondary font-mono text-xs">
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={async () => {
                          try {
                            await api.deleteBankConnection(conn.id);
                            if (onRefresh) onRefresh();
                          } catch (err: any) {
                            alert(`Failed to delete connection: ${err.message || 'Unknown error'}`);
                          }
                        }}
                        className="bg-rose-600 text-white hover:bg-rose-500 font-mono text-xs"
                      >
                        Remove Connection
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </Panel>
          ))}
        </div>
      ) : isLoading ? (
        <Panel className="p-12 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent/70 mb-3" />
          <h3 className="font-mono text-sm uppercase tracking-widest text-ink-primary font-semibold">
            Loading Bank Connections
          </h3>
          <p className="mt-1 font-sans text-xs text-ink-secondary max-w-sm mx-auto">
            Fetching registered MCP servers and OpenAPI connections.
          </p>
        </Panel>
      ) : (
        <Panel className="p-12 text-center">
          <Server className="mx-auto h-8 w-8 text-ink-secondary/40 mb-3" />
          <h3 className="font-mono text-sm uppercase tracking-widest text-ink-primary font-semibold">
            No Bank Connections Registered
          </h3>
          <p className="mt-1 font-sans text-xs text-ink-secondary max-w-sm mx-auto">
            Connect a native Model Context Protocol (MCP) server or virtualize an existing OpenAPI REST API to start exposing tool endpoints.
          </p>
          <Button
            onClick={() => setShowWizard(true)}
            className="mt-4 border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 font-mono text-xs"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add Connection
          </Button>
        </Panel>
      )}

      <Dialog open={showWizard} onOpenChange={setShowWizard}>
        <DialogContent className="max-w-2xl border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest text-ink-primary">
              Register Bank Connection / MCP Server
            </DialogTitle>
          </DialogHeader>
          <RegisterConnectionForm
            onComplete={() => {
              setShowWizard(false);
              if (onRefresh) onRefresh();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingConn} onOpenChange={(open) => !open && setEditingConn(null)}>
        <DialogContent className="max-w-2xl border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest text-ink-primary">
              Edit Connection — {editingConn?.name}
            </DialogTitle>
          </DialogHeader>
          {editingConn && (
            <EditConnectionForm
              conn={editingConn}
              onComplete={() => {
                setEditingConn(null);
                if (onRefresh) onRefresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditConnectionForm({
  conn,
  onComplete,
}: {
  conn: BankConnection;
  onComplete: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authType, setAuthType] = useState(conn.authType || 'none');
  const [token, setToken] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.updateBankConnection(conn.id, {
        credential_type: authType,
        credentials: authType !== 'none' && token ? token : undefined,
      });
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Failed to update connection');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 pt-2">
      <div className="rounded border border-white/10 bg-white/[0.02] p-3 font-mono text-[11px] text-ink-secondary">
        <div>Type: <span className="text-ink-primary">{conn.sourceType === 'native_mcp' ? 'Native MCP' : 'OpenAPI Virtualized'}</span></div>
        {conn.mcpUrl && <div>URL: <span className="text-ink-primary">{conn.mcpUrl}</span></div>}
        {conn.baseUrl && !conn.mcpUrl && <div>Base URL: <span className="text-ink-primary">{conn.baseUrl}</span></div>}
        <div className="mt-1 text-[10px] text-ink-secondary/70">
          Credentials are encrypted at rest and injected by the gateway at call time — agents never see them.
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 border border-rose-500/30 bg-rose-500/10 p-3 rounded text-xs font-mono text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Authentication</Label>
          <Select value={authType} onValueChange={setAuthType}>
            <SelectTrigger className="mt-1 border-white/10 bg-white/5 font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-slate-900 text-white font-mono text-xs">
              <SelectItem value="none">None / Public</SelectItem>
              <SelectItem value="bearer">Bearer Token</SelectItem>
              <SelectItem value="api_key">API Key Header</SelectItem>
              <SelectItem value="basic">Basic Auth</SelectItem>
              <SelectItem value="header">Custom Header</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {authType !== 'none' && (
          <div>
            <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
              {authType === 'header' ? 'Header (Name: value)' : 'Secret / Token'}
            </Label>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={authType === 'header' ? 'X-Api-Key: secret' : '••••••••••••'}
              className="mt-1 border-white/10 bg-white/5 font-mono text-xs"
              required
            />
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-3">
        <Button
          type="button"
          onClick={onComplete}
          className="border border-white/10 bg-transparent text-ink-secondary hover:bg-white/5 font-mono text-xs"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={loading}
          className="bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-mono text-xs font-semibold px-5 h-8"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
          Save Credentials
        </Button>
      </div>
    </form>
  );
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET': return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    case 'POST': return 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20';
    case 'DELETE': return 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
    case 'PUT': return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
    default: return 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
  }
}

function RegisterConnectionForm({ onComplete }: { onComplete: () => void }) {
  const [sourceType, setSourceType] = useState<'native_mcp' | 'openapi'>('native_mcp');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Native MCP Form Fields
  const [mcpName, setMcpName] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');
  const [mcpAuthType, setMcpAuthType] = useState('none');
  const [mcpToken, setMcpToken] = useState('');

  // OpenAPI Form Fields
  const [apiName, setApiName] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiAuthType, setApiAuthType] = useState('none');
  const [apiToken, setApiToken] = useState('');
  const [specInputMode, setSpecInputMode] = useState<'url' | 'raw'>('raw');
  const [specUrl, setSpecUrl] = useState('');
  const [specRaw, setSpecRaw] = useState('');

  const handleNativeMcpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!mcpName || !mcpUrl) {
      setError('Please provide Name and MCP Server URL.');
      return;
    }
    setLoading(true);
    try {
      // Status is derived by the backend from a live discovery probe — never asserted here.
      // id is derived from the name (slugified) by the backend when omitted.
      await api.createBankConnection({
        name: mcpName,
        source_type: 'native_mcp',
        sourceType: 'native_mcp',
        mcp_url: mcpUrl.trim(),
        mcpUrl: mcpUrl.trim(),
        credential_type: mcpAuthType,
        credentials: mcpAuthType !== 'none' && mcpToken ? mcpToken : undefined,
      } as any);
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Failed to register native MCP server');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenApiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // id is derived from the connection name (slugified) when omitted.
    const connId = apiName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!apiName || !connId) {
      setError('Please provide Connection Name.');
      return;
    }

    let specText = specRaw;
    if (specInputMode === 'url') {
      if (!specUrl) {
        setError('Please provide OpenAPI Spec URL.');
        return;
      }
      try {
        setLoading(true);
        const res = await fetch(specUrl);
        specText = await res.text();
      } catch (err: any) {
        setError(`Failed to fetch spec from URL: ${err.message}`);
        setLoading(false);
        return;
      }
    }

    if (!specText.trim()) {
      setError('OpenAPI Spec content cannot be empty.');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      await api.registerOpenAPISpec(
        connId,
        specText,
        apiBaseUrl || undefined,
        apiName || undefined,
        apiAuthType,
        apiAuthType !== 'none' && apiToken ? apiToken : undefined,
      );
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Failed to register OpenAPI spec');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      {/* 2-Option Source Selection */}
      <div>
        <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary mb-2 block">
          Registration Type
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => { setSourceType('native_mcp'); setError(''); }}
            className={cn(
              'flex flex-col items-center gap-1.5 border p-4 transition-[background-color,border-color,color] rounded',
              sourceType === 'native_mcp'
                ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400 font-semibold'
                : 'border-white/10 bg-white/[0.02] text-ink-secondary hover:text-ink-primary hover:border-white/20'
            )}
          >
            <Link2 className="h-6 w-6" />
            <span className="font-mono text-xs uppercase tracking-wider">1. Native MCP Server</span>
            <span className="font-sans text-[11px] text-ink-secondary text-center">Connect an existing MCP server directly via URL</span>
          </button>

          <button
            type="button"
            onClick={() => { setSourceType('openapi'); setError(''); }}
            className={cn(
              'flex flex-col items-center gap-1.5 border p-4 transition-[background-color,border-color,color] rounded',
              sourceType === 'openapi'
                ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400 font-semibold'
                : 'border-white/10 bg-white/[0.02] text-ink-secondary hover:text-ink-primary hover:border-white/20'
            )}
          >
            <FileUp className="h-6 w-6" />
            <span className="font-mono text-xs uppercase tracking-wider">2. Virtualize OpenAPI REST</span>
            <span className="font-sans text-[11px] text-ink-secondary text-center">Convert REST endpoints into governed MCP tools</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 border border-rose-500/30 bg-rose-500/10 p-3 rounded text-xs font-mono text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Option 1: Native MCP Form */}
      {sourceType === 'native_mcp' && (
        <form onSubmit={handleNativeMcpSubmit} className="space-y-3 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Server Name</Label>
              <Input
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
                placeholder="e.g. Bank of Anthos Payments"
                className="mt-1 border-white/10 bg-white/5 font-mono text-xs"
                required
              />
              <p className="mt-1 font-mono text-[10px] text-ink-secondary">
                ID: <span className="text-cyan-400">{mcpName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '—'}</span>
              </p>
            </div>
          </div>

          <div>
            <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Target MCP Server URL</Label>
            <Input
              value={mcpUrl}
              onChange={(e) => setMcpUrl(e.target.value)}
              placeholder="https://your-mcp-server.example.com/mcp"
              className="mt-1 border-white/10 bg-white/5 font-mono text-xs"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Authentication</Label>
              <Select value={mcpAuthType} onValueChange={setMcpAuthType}>
                <SelectTrigger className="mt-1 border-white/10 bg-white/5 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-slate-900 text-white font-mono text-xs">
                  <SelectItem value="none">None / Public</SelectItem>
                  <SelectItem value="bearer">Bearer Token</SelectItem>
                  <SelectItem value="api_key">API Key Header</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mcpAuthType !== 'none' && (
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Secret / Token</Label>
                <Input
                  type="password"
                  value={mcpToken}
                  onChange={(e) => setMcpToken(e.target.value)}
                  placeholder="••••••••••••"
                  className="mt-1 border-white/10 bg-white/5 font-mono text-xs"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end pt-3">
            <Button
              type="submit"
              disabled={loading}
              className="bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-mono text-xs font-semibold px-5 h-8"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plug className="h-4 w-4 mr-2" />}
              Connect MCP Server
            </Button>
          </div>
        </form>
      )}

      {/* Option 2: OpenAPI Spec Virtualization Form */}
      {sourceType === 'openapi' && (
        <form onSubmit={handleOpenApiSubmit} className="space-y-3 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Service Name</Label>
              <Input
                value={apiName}
                onChange={(e) => setApiName(e.target.value)}
                placeholder="e.g. Core Banking REST API"
                className="mt-1 border-white/10 bg-white/5 font-mono text-xs"
                required
              />
              <p className="mt-1 font-mono text-[10px] text-ink-secondary">
                ID: <span className="text-cyan-400">{apiName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '—'}</span>
              </p>
            </div>
          </div>

          <div>
            <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Base REST API URL</Label>
            <Input
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder="https://your-api.example.com"
              className="mt-1 border-white/10 bg-white/5 font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Authentication</Label>
              <Select value={apiAuthType} onValueChange={setApiAuthType}>
                <SelectTrigger className="mt-1 border-white/10 bg-white/5 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-slate-900 text-white font-mono text-xs">
                  <SelectItem value="none">None / Public</SelectItem>
                  <SelectItem value="bearer">Bearer Token</SelectItem>
                  <SelectItem value="api_key">API Key Header</SelectItem>
                  <SelectItem value="basic">Basic Auth</SelectItem>
                  <SelectItem value="header">Custom Header</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {apiAuthType !== 'none' && (
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                  {apiAuthType === 'header' ? 'Header (Name: value)' : 'Secret / Token'}
                </Label>
                <Input
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder={apiAuthType === 'header' ? 'X-Api-Key: secret' : '••••••••••••'}
                  className="mt-1 border-white/10 bg-white/5 font-mono text-xs"
                />
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">OpenAPI Specification</Label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSpecInputMode('raw')}
                  className={cn('px-2 py-0.5 font-mono text-[10px] rounded', specInputMode === 'raw' ? 'bg-cyan-500/20 text-cyan-400' : 'text-ink-secondary')}
                >
                  Raw Spec (JSON/YAML)
                </button>
                <button
                  type="button"
                  onClick={() => setSpecInputMode('url')}
                  className={cn('px-2 py-0.5 font-mono text-[10px] rounded', specInputMode === 'url' ? 'bg-cyan-500/20 text-cyan-400' : 'text-ink-secondary')}
                >
                  Spec URL
                </button>
              </div>
            </div>

            {specInputMode === 'raw' ? (
              <Textarea
                value={specRaw}
                onChange={(e) => setSpecRaw(e.target.value)}
                placeholder='{"openapi": "3.0.0", "info": {"title": "Bank REST API"}, "paths": {...}}'
                className="h-36 border-white/10 bg-white/5 font-mono text-[11px] leading-relaxed"
              />
            ) : (
              <Input
                value={specUrl}
                onChange={(e) => setSpecUrl(e.target.value)}
                placeholder="https://api.bank.example/v1/openapi.json"
                className="border-white/10 bg-white/5 font-mono text-xs"
              />
            )}
          </div>

          <div className="flex justify-end pt-3">
            <Button
              type="submit"
              disabled={loading}
              className="bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-mono text-xs font-semibold px-5 h-8"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileUp className="h-4 w-4 mr-2" />}
              Register & Virtualize Spec
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
