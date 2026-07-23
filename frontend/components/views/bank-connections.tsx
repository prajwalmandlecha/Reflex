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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BankConnection, BankTool } from '@/lib/types';
import { formatRelative } from '@/lib/format';
import { Plus, Plug, FileUp, Link2, Keyboard, Check, AlertCircle, ChevronRight, ChevronLeft, Lock } from 'lucide-react';

const sourceTypeLabel: Record<string, string> = {
  native_mcp: 'Native MCP',
  openapi: 'OpenAPI',
  manual: 'Manual',
};

export function BankConnectionsView({
  connections,
}: {
  connections: BankConnection[];
}) {
  const [showWizard, setShowWizard] = useState(false);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-ink-primary">
            Bank Connections
          </h2>
          <p className="font-sans text-xs text-ink-secondary">
            Registered bank systems and their exposed tools. Agents can only use tools from connected systems.
          </p>
        </div>
        <Button
          onClick={() => setShowWizard(true)}
          className="border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add connection
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {connections.map((conn) => (
          <Panel key={conn.id}>
            <div className="flex items-start justify-between border-b border-white/5 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center border border-border bg-white/5">
                  <Plug className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <div className="font-mono text-sm text-ink-primary">{conn.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                    {sourceTypeLabel[conn.sourceType]}
                    <span>·</span>
                    <span>{conn.toolCount} tools</span>
                    {conn.lastSync && (
                      <>
                        <span>·</span>
                        <span>synced {formatRelative(conn.lastSync)}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <StatusBadge status={conn.status} />
            </div>

            {conn.tools.length > 0 ? (
              <div className="p-3">
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                  Exposed Tools
                </div>
                <div className="mt-1.5 space-y-1">
                  {conn.tools.filter((t) => t.exposed).map((tool) => (
                    <div key={tool.id} className="flex items-center gap-2">
                      <span className={cn('rounded px-1 py-0.5 font-mono text-[9px]', methodColor(tool.method))}>
                        {tool.method}
                      </span>
                      <span className="font-mono text-xs text-ink-primary">{tool.name}</span>
                      <span className="truncate font-mono text-[10px] text-ink-secondary">{tool.path}</span>
                    </div>
                  ))}
                </div>
                {conn.tools.some((t) => !t.exposed) && (
                  <div className="mt-2 font-mono text-[10px] text-ink-secondary/60">
                    {conn.tools.filter((t) => !t.exposed).length} tools hidden (not exposed)
                  </div>
                )}
                {conn.tools.some((t) => !t.convertible) && (
                  <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-signal-caution">
                    <AlertCircle className="h-3 w-3" />
                    {conn.tools.filter((t) => !t.convertible).length} tools could not be auto-converted
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center font-mono text-xs text-ink-secondary">
                {conn.status === 'pending'
                  ? 'Awaiting configuration — complete setup to expose tools.'
                  : 'No tools registered.'}
              </div>
            )}
          </Panel>
        ))}
      </div>

      <Dialog open={showWizard} onOpenChange={setShowWizard}>
        <DialogContent className="max-w-2xl border-white/10 bg-white/[0.02]">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest">
              Add Bank Connection
            </DialogTitle>
          </DialogHeader>
          <AddConnectionWizard />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function methodColor(method: string): string {
  switch (method) {
    case 'GET': return 'bg-signal-healthy/10 text-signal-healthy';
    case 'POST': return 'bg-accent/10 text-accent';
    case 'DELETE': return 'bg-signal-stopped/10 text-signal-stopped';
    case 'PUT': return 'bg-signal-caution/10 text-signal-caution';
    default: return 'bg-white/5 text-ink-secondary';
  }
}

function AddConnectionWizard() {
  const [step, setStep] = useState(0);
  const [sourceType, setSourceType] = useState<'openapi' | 'manual' | 'native_mcp'>('openapi');
  const [specUrl, setSpecUrl] = useState('');
  const [parsedTools, setParsedTools] = useState<BankTool[]>([]);
  const [authType, setAuthType] = useState<string>('bearer');

  const steps = ['Source', 'Endpoints', 'Auth', 'Review'];

  const simulateParse = () => {
    setParsedTools([
      { id: 'p1', name: 'get_account', method: 'GET', path: '/v1/accounts/{id}', description: 'Retrieve account details', exposed: true, convertible: true },
      { id: 'p2', name: 'create_transfer', method: 'POST', path: '/v1/transfers', description: 'Create a new transfer', exposed: true, convertible: true },
      { id: 'p3', name: 'get_balance', method: 'GET', path: '/v1/accounts/{id}/balance', description: 'Get account balance', exposed: false, convertible: true },
      { id: 'p4', name: 'raw_webhook', method: 'POST', path: '/v1/webhooks/raw', description: 'Raw webhook passthrough', exposed: false, convertible: false },
    ]);
    setStep(1);
  };

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div
              className={cn(
                'flex h-6 w-6 items-center justify-center border font-mono text-[10px]',
                i === step
                  ? 'border-accent bg-accent/10 text-accent'
                  : i < step
                  ? 'border-signal-healthy/40 bg-signal-healthy/10 text-signal-healthy'
                  : 'border-border text-ink-secondary'
              )}
            >
              {i < step ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            {i < steps.length - 1 && <div className="h-px w-8 bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 0: Source */}
      {step === 0 && (
        <div className="space-y-3">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            Choose Source
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'openapi', label: 'OpenAPI Spec', icon: FileUp, desc: 'Upload or paste URL' },
              { id: 'native_mcp', label: 'Native MCP', icon: Link2, desc: 'MCP server' },
              { id: 'manual', label: 'Manual Entry', icon: Keyboard, desc: 'Define by hand' },
            ].map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  onClick={() => setSourceType(opt.id as typeof sourceType)}
                  className={cn(
                    'flex flex-col items-center gap-1 border p-3 transition-colors',
                    sourceType === opt.id
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-white/5 text-ink-secondary hover:text-ink-primary'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="font-mono text-[10px] uppercase tracking-wider">{opt.label}</span>
                  <span className="font-sans text-[10px] text-ink-secondary">{opt.desc}</span>
                </button>
              );
            })}
          </div>

          {sourceType === 'openapi' && (
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                OpenAPI Spec URL
              </Label>
              <Input
                value={specUrl}
                onChange={(e) => setSpecUrl(e.target.value)}
                placeholder="https://api.bank.example/openapi.json"
                className="mt-1 border-border bg-white/5 font-mono text-sm"
              />
            </div>
          )}

          <Button onClick={simulateParse} className="bg-accent text-white hover:bg-accent/90">
            Parse spec
          </Button>
        </div>
      )}

      {/* Step 1: Endpoints */}
      {step === 1 && (
        <div className="space-y-3">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            Select Endpoints to Expose as Tools
          </Label>
          <div className="space-y-1.5">
            {parsedTools.map((tool) => (
              <label
                key={tool.id}
                className="flex items-center gap-3 border border-border bg-white/5 p-2"
              >
                <Checkbox
                  checked={tool.exposed}
                  onCheckedChange={(checked) =>
                    setParsedTools((prev) =>
                      prev.map((t) =>
                        t.id === tool.id ? { ...t, exposed: !!checked } : t
                      )
                    )
                  }
                />
                <span className={cn('rounded px-1.5 py-0.5 font-mono text-[9px]', methodColor(tool.method))}>
                  {tool.method}
                </span>
                <span className="font-mono text-xs text-ink-primary">{tool.path}</span>
                <span className="flex-1 truncate font-sans text-[11px] text-ink-secondary">
                  {tool.description}
                </span>
                {!tool.convertible && (
                  <span className="flex items-center gap-1 font-mono text-[9px] text-signal-caution">
                    <AlertCircle className="h-3 w-3" />
                    not convertible
                  </span>
                )}
              </label>
            ))}
          </div>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)} className="border-border text-ink-secondary">
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button onClick={() => setStep(2)} className="bg-accent text-white hover:bg-accent/90">
              Continue <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Auth */}
      {step === 2 && (
        <div className="space-y-3">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            Authentication Type
          </Label>
          <Select value={authType} onValueChange={setAuthType}>
            <SelectTrigger className="border-border bg-white/5 font-mono text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-border bg-white/5">
              <SelectItem value="api_key">API Key</SelectItem>
              <SelectItem value="bearer">Bearer Token</SelectItem>
              <SelectItem value="basic">Basic Auth</SelectItem>
              <SelectItem value="oauth2">OAuth2 (Client Credentials)</SelectItem>
            </SelectContent>
          </Select>

          {authType === 'api_key' && (
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                API Key
              </Label>
              <Input type="password" placeholder="••••••••••••" className="mt-1 border-border bg-white/5 font-mono text-sm" />
            </div>
          )}
          {authType === 'bearer' && (
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                Bearer Token
              </Label>
              <Input type="password" placeholder="••••••••••••" className="mt-1 border-border bg-white/5 font-mono text-sm" />
            </div>
          )}
          {authType === 'basic' && (
            <>
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Username</Label>
                <Input className="mt-1 border-border bg-white/5 font-mono text-sm" />
              </div>
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Password</Label>
                <Input type="password" className="mt-1 border-border bg-white/5 font-mono text-sm" />
              </div>
            </>
          )}
          {authType === 'oauth2' && (
            <>
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Token URL</Label>
                <Input placeholder="https://auth.bank.example/token" className="mt-1 border-border bg-white/5 font-mono text-sm" />
              </div>
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Client ID</Label>
                <Input className="mt-1 border-border bg-white/5 font-mono text-sm" />
              </div>
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">Client Secret</Label>
                <Input type="password" className="mt-1 border-border bg-white/5 font-mono text-sm" />
              </div>
            </>
          )}

          <div className="flex items-center gap-1.5 font-mono text-[10px] text-ink-secondary">
            <Lock className="h-3 w-3" />
            Credential values are masked and never re-displayed after save.
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)} className="border-border text-ink-secondary">
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button onClick={() => setStep(3)} className="bg-accent text-white hover:bg-accent/90">
              Continue <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <div className="space-y-3">
          <div className="border border-border bg-white/5 p-3">
            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              <div>
                <span className="text-ink-secondary">Source: </span>
                <span className="text-ink-primary">{sourceTypeLabel[sourceType]}</span>
              </div>
              <div>
                <span className="text-ink-secondary">Tools: </span>
                <span className="text-ink-primary">{parsedTools.filter((t) => t.exposed).length} exposed</span>
              </div>
              <div>
                <span className="text-ink-secondary">Auth: </span>
                <span className="text-ink-primary">{authType}</span>
              </div>
              <div>
                <span className="text-ink-secondary">Spec URL: </span>
                <span className="truncate text-ink-primary">{specUrl || 'manual'}</span>
              </div>
            </div>
          </div>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)} className="border-border text-ink-secondary">
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button className="bg-signal-healthy text-black hover:bg-signal-healthy/90">
              Publish connection
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
