'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Panel } from '@/components/gov/panel';
import { StatusBadge } from '@/components/gov/status-badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { Policy, AgentClass, VisualRule, RuleCondition } from '@/lib/types';
import { Plus, Code2, FileJson, Play, CheckCircle2, XCircle, Pencil, FileText } from 'lucide-react';

export function PoliciesView({
  policies,
  classes,
}: {
  policies: Policy[];
  classes: AgentClass[];
}) {
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-ink-primary">
            Policies
          </h2>
          <p className="font-sans text-xs text-ink-secondary">
            Author governance rules visually or in Rego. Validate and dry-run before activating.
          </p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          New policy
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Policy list */}
        <Panel title="All Policies" className="lg:col-span-1">
          <div className="flex flex-col">
            {policies.map((pol) => (
              <button
                key={pol.id}
                onClick={() => setSelectedPolicy(pol)}
                className={cn(
                  'border-b border-white/5 p-3 text-left transition-colors last:border-0',
                  selectedPolicy?.id === pol.id
                    ? 'bg-accent/10'
                    : 'hover:bg-white/5'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-ink-primary">
                    {pol.name}
                  </span>
                  <StatusBadge status={pol.status} />
                </div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-ink-secondary">
                  <span>{pol.type === 'visual' ? 'Visual' : 'Rego'}</span>
                  <span>·</span>
                  <span>{pol.scope === 'class' ? 'Class' : 'Instance'}</span>
                  <span>·</span>
                  <span>{pol.targetName}</span>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-ink-secondary/60">
                  {formatRelative(pol.lastModified)}
                </div>
              </button>
            ))}
          </div>
        </Panel>

        {/* Policy detail / editor */}
        <div className="lg:col-span-2">
          {selectedPolicy || showCreate ? (
            <PolicyEditor
              policy={selectedPolicy}
              classes={classes}
              isNew={showCreate}
            />
          ) : (
            <Panel>
              <div className="flex h-full min-h-[300px] items-center justify-center p-8">
                <div className="text-center">
                  <FileText className="mx-auto h-8 w-8 text-ink-secondary/40" />
                  <p className="mt-3 font-mono text-xs text-ink-secondary">
                    Select a policy to view or edit, or create a new one.
                  </p>
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function PolicyEditor({
  policy,
  classes,
  isNew,
}: {
  policy: Policy | null;
  classes: AgentClass[];
  isNew: boolean;
}) {
  const [mode, setMode] = useState<'visual' | 'rego'>(
    policy?.type ?? 'visual'
  );
  const [regoSource, setRegoSource] = useState(
    policy?.regoSource ?? `package governance.guard\n\ndefault allow := false\n\nallow if {\n  input.action == ""\n  input.params.amount <= 100000\n}\n\ndeny[msg] if {\n  input.action == ""\n  input.params.amount > 100000\n  msg := "Amount exceeds limit"\n}`
  );
  const [validationResult, setValidationResult] = useState<
    { ok: boolean; message: string } | null
  >(null);
  const [dryRunResult, setDryRunResult] = useState<
    { allowed: number; denied: number; changed: { action: string; was: string; now: string }[] } | null
  >(null);
  const [rule, setRule] = useState<VisualRule>(
    policy?.visualRule ?? {
      action: 'wire_transfer',
      conditions: [{ field: 'amount', operator: 'lte', value: 100000 }],
    }
  );

  const handleValidate = () => {
    if (mode === 'rego') {
      const hasPackage = regoSource.includes('package ');
      const hasDefault = regoSource.includes('default allow');
      if (!hasPackage || !hasDefault) {
        setValidationResult({
          ok: false,
          message: 'Missing required elements: package declaration or default allow rule.',
        });
      } else {
        setValidationResult({
          ok: true,
          message: 'Rego syntax valid — 0 errors, 0 warnings.',
        });
      }
    } else {
      if (!rule.action || rule.conditions.length === 0) {
        setValidationResult({
          ok: false,
          message: 'Visual rule must specify an action and at least one condition.',
        });
      } else {
        setValidationResult({
          ok: true,
          message: 'Visual rule valid — 1 action, ' + rule.conditions.length + ' conditions.',
        });
      }
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
      ],
    });
  };

  return (
    <Panel
      title={isNew ? 'New Policy' : policy?.name ?? 'Policy'}
      action={
        <div className="flex items-center gap-2">
          {policy && <StatusBadge status={policy.status} />}
        </div>
      }
    >
      <div className="p-4">
        {isNew && (
          <div className="mb-4">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
              Policy Name
            </Label>
            <Input
              placeholder="e.g. Treasury Wire Cap Guard"
              className="mt-1 border-border bg-white/5 font-mono text-sm"
            />
          </div>
        )}

        <div className="mb-4">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            Scope
          </Label>
          <div className="mt-1 flex gap-2">
            <Select defaultValue={policy?.scope ?? 'class'}>
              <SelectTrigger className="w-[120px] border-border bg-white/5 font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border bg-white/5">
                <SelectItem value="class">Class</SelectItem>
                <SelectItem value="instance">Instance</SelectItem>
              </SelectContent>
            </Select>
            <Select defaultValue={policy?.targetId ?? classes[0]?.id ?? ''}>
              <SelectTrigger className="flex-1 border-border bg-white/5 font-mono text-xs">
                <SelectValue placeholder="Target" />
              </SelectTrigger>
              <SelectContent className="border-border bg-white/5">
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as 'visual' | 'rego')}>
          <TabsList className="border border-border bg-white/5">
            <TabsTrigger
              value="visual"
              className="data-[state=active]:bg-surface data-[state=active]:text-accent font-mono text-xs"
            >
              <Pencil className="mr-1.5 h-3 w-3" />
              Visual Builder
            </TabsTrigger>
            <TabsTrigger
              value="rego"
              className="data-[state=active]:bg-surface data-[state=active]:text-accent font-mono text-xs"
            >
              <Code2 className="mr-1.5 h-3 w-3" />
              Rego Editor
            </TabsTrigger>
          </TabsList>

          <TabsContent value="visual">
            <VisualRuleBuilder rule={rule} setRule={setRule} />
          </TabsContent>

          <TabsContent value="rego">
            <RegoEditor source={regoSource} setSource={setRegoSource} />
          </TabsContent>
        </Tabs>

        {/* Validate + Dry Run */}
        <div className="mt-4 flex items-center gap-2 border-t border-white/5 pt-4">
          <Button
            onClick={handleValidate}
            variant="outline"
            className="border-border text-ink-primary hover:bg-white/5"
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            Validate
          </Button>
          <Button
            onClick={handleDryRun}
            variant="outline"
            className="border-border text-ink-primary hover:bg-white/5"
          >
            <Play className="mr-1.5 h-4 w-4" />
            Dry run
          </Button>

          {validationResult && (
            <span
              className={cn(
                'flex items-center gap-1.5 font-mono text-xs',
                validationResult.ok ? 'text-signal-healthy' : 'text-signal-stopped'
              )}
            >
              {validationResult.ok ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {validationResult.message}
            </span>
          )}
        </div>

        {/* Dry run results */}
        {dryRunResult && (
          <div className="mt-3 border border-border bg-white/5 p-3">
            <div className="mb-2 flex items-center gap-3 font-mono text-xs">
              <span className="text-signal-healthy">
                {dryRunResult.allowed} would be allowed
              </span>
              <span className="text-signal-stopped">
                {dryRunResult.denied} would be denied
              </span>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
              Changed decisions ({dryRunResult.changed.length})
            </div>
            <div className="mt-1 space-y-1">
              {dryRunResult.changed.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 border-b border-white/5 pb-1 last:border-0"
                >
                  <span className="flex-1 truncate font-mono text-[11px] text-ink-primary">
                    {c.action}
                  </span>
                  <span className="font-mono text-[10px] text-signal-healthy">
                    {c.was}
                  </span>
                  <span className="font-mono text-[10px] text-ink-secondary">→</span>
                  <span className="font-mono text-[10px] text-signal-stopped">
                    {c.now}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Save / Activate */}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" className="border-border text-ink-secondary">
            Save draft
          </Button>
          <Button className="bg-signal-healthy text-black hover:bg-signal-healthy/90">
            Activate policy
          </Button>
        </div>

        {policy && (
          <div className="mt-3 font-mono text-[10px] text-ink-secondary">
            Last modified: {formatDateTime(policy.lastModified)}
          </div>
        )}
      </div>
    </Panel>
  );
}

function VisualRuleBuilder({
  rule,
  setRule,
}: {
  rule: VisualRule;
  setRule: (r: VisualRule) => void;
}) {
  const actions = [
    'wire_transfer', 'ach_transfer', 'sepa_transfer', 'fx_quote',
    'sweep_account', 'market_order', 'limit_order', 'sanctions_check',
    'kyc_lookup', 'alert_disposition',
  ];
  const fields = ['amount', 'currency', 'venue', 'symbol', 'timestamp', 'counterparty'];
  const operators: RuleCondition['operator'][] = ['eq', 'lt', 'gt', 'lte', 'gte', 'in', 'contains'];

  const addCondition = () => {
    setRule({
      ...rule,
      conditions: [...rule.conditions, { field: 'amount', operator: 'lte', value: 0 }],
    });
  };

  const updateCondition = (idx: number, patch: Partial<RuleCondition>) => {
    setRule({
      ...rule,
      conditions: rule.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    });
  };

  const removeCondition = (idx: number) => {
    setRule({
      ...rule,
      conditions: rule.conditions.filter((_, i) => i !== idx),
    });
  };

  return (
    <div className="space-y-3 border border-border bg-white/5 p-3">
      <div>
        <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
          Action
        </Label>
        <Select value={rule.action} onValueChange={(v) => setRule({ ...rule, action: v })}>
          <SelectTrigger className="mt-1 border-white/10 bg-white/[0.02] font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-border bg-white/5">
            {actions.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            Conditions (AND)
          </Label>
          <button
            onClick={addCondition}
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-accent hover:underline"
          >
            <Plus className="h-3 w-3" /> Add condition
          </button>
        </div>
        <div className="mt-1.5 space-y-2">
          {rule.conditions.map((cond, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Select
                value={cond.field}
                onValueChange={(v) => updateCondition(idx, { field: v })}
              >
                <SelectTrigger className="w-[120px] border-white/10 bg-white/[0.02] font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-white/5">
                  {fields.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={cond.operator}
                onValueChange={(v) => updateCondition(idx, { operator: v as RuleCondition['operator'] })}
              >
                <SelectTrigger className="w-[80px] border-white/10 bg-white/[0.02] font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-white/5">
                  {operators.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={String(cond.value)}
                onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 border-white/10 bg-white/[0.02] font-mono text-xs"
              />
              <button
                onClick={() => removeCondition(idx)}
                className="text-ink-secondary hover:text-signal-stopped"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RegoEditor({
  source,
  setSource,
}: {
  source: string;
  setSource: (s: string) => void;
}) {
  return (
    <div className="border border-border bg-bg-deep">
      <div className="flex items-center gap-2 border-b border-white/5 bg-white/5 px-3 py-1.5">
        <FileJson className="h-3.5 w-3.5 text-ink-secondary" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
          policy.rego
        </span>
      </div>
      <textarea
        value={source}
        onChange={(e) => setSource(e.target.value)}
        spellCheck={false}
        className="h-[280px] w-full resize-none bg-bg-deep p-3 font-mono text-xs leading-relaxed text-ink-primary outline-none"
      />
    </div>
  );
}
