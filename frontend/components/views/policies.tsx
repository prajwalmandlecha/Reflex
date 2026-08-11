'use client';

import { useState, useMemo, useEffect } from 'react';
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
import type { Policy, AgentClass, AgentInstance, VisualRule, RuleCondition, BankConnection, BankTool } from '@/lib/types';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Plus, Code2, FileJson, Play, CheckCircle2, XCircle, Pencil, FileText, FlaskConical, AlertTriangle, Layers, User, Shield, Sliders, LayoutGrid, Check, Trash2, Eye } from 'lucide-react';

export function PoliciesView({
  policies,
  classes,
  instances = [],
  onRefresh,
}: {
  policies: Policy[];
  classes: AgentClass[];
  instances?: AgentInstance[];
  onRefresh?: () => void;
}) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('policies:create');
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [connections, setConnections] = useState<BankConnection[]>([]);

  useEffect(() => {
    api.getBankConnections().then(setConnections).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-ink-primary">
            Policies & Dynamic Constraints
          </h2>
          <p className="font-sans text-xs text-ink-secondary">
            Author governance rules visually or in Rego code. Test custom inputs and validate before activating.
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => {
              setSelectedPolicy(null);
              setShowCreate(true);
            }}
            className="border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 font-mono text-xs"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New Policy
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Policy list */}
        <Panel title="All Governance Policies" className="lg:col-span-1">
          <div className="flex flex-col">
            {policies.map((pol) => (
              <button
                key={pol.id}
                onClick={() => {
                  setShowCreate(false);
                  setSelectedPolicy(pol);
                }}
                className={cn(
                  'border-b border-white/5 p-3 text-left transition-colors last:border-0',
                  selectedPolicy?.id === pol.id && !showCreate
                    ? 'bg-accent/10'
                    : 'hover:bg-white/5'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-ink-primary font-medium">
                    {pol.name}
                  </span>
                  <StatusBadge status={pol.status} />
                </div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-ink-secondary">
                  <span>{pol.type === 'visual' ? 'Visual' : 'Rego'}</span>
                  <span>·</span>
                  <span className="capitalize">{pol.scope}</span>
                  <span>·</span>
                  <span className="truncate">{pol.targetName || pol.targetId || pol.scope}</span>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-ink-secondary/60">
                  {formatRelative(pol.lastModified || pol.updated_at || new Date().toISOString())}
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
              instances={instances}
              connections={connections}
              isNew={showCreate}
              onRefresh={onRefresh}
              onComplete={(savedPolicy) => {
                setShowCreate(false);
                if (savedPolicy) setSelectedPolicy(savedPolicy);
              }}
              onCancel={() => {
                setShowCreate(false);
                setSelectedPolicy(null);
              }}
            />
          ) : (
            <Panel>
              <div className="flex h-full min-h-[300px] items-center justify-center p-8">
                <div className="text-center">
                  <FileText className="mx-auto h-8 w-8 text-ink-secondary/40" />
                  <p className="mt-3 font-mono text-xs text-ink-secondary">
                    Select a policy from the left list to edit, or click 'New Policy' to build one.
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
  instances,
  connections,
  isNew,
  onRefresh,
  onComplete,
  onCancel,
}: {
  policy: Policy | null;
  classes: AgentClass[];
  instances: AgentInstance[];
  connections: BankConnection[];
  isNew: boolean;
  onRefresh?: () => void;
  onComplete?: (savedPolicy?: Policy) => void;
  onCancel?: () => void;
}) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('policies:update') || hasPermission('policies:create');
  const canArchive = hasPermission('policies:archive');

  const [name, setName] = useState(policy?.name ?? '');
  const [scope, setScope] = useState<'global' | 'class' | 'instance'>(policy?.scope ?? 'global');
  
  // Scope targets
  const [targetClassId, setTargetClassId] = useState<string>('');
  const [targetInstanceId, setTargetInstanceId] = useState<string>(policy?.targetId ?? policy?.target_id ?? '');

  const [mode, setMode] = useState<'visual' | 'rego'>(policy?.type ?? 'visual');
  const [regoSource, setRegoSource] = useState(policy?.regoSource ?? policy?.rego_source ?? '');
  const [validationResult, setValidationResult] = useState<{ ok: boolean; message: string } | null>(null);
  
  const [rule, setRule] = useState<VisualRule>(
    policy?.visualRule ?? {
      action: 'transfer_money',
      conditions: [{ field: 'amount_cents', operator: 'gt', value: 100000 }],
    }
  );
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Derive allowed tools based on selected scope & target
  const allowedToolsForTarget = useMemo(() => {
    const allToolsMap = new Map<string, BankTool>();
    connections.forEach((conn) => {
      conn.tools?.forEach((t) => allToolsMap.set(t.name, t));
    });

    if (scope === 'global') {
      return Array.from(allToolsMap.values());
    }

    let allowedNames: string[] = [];
    if (scope === 'class' && targetClassId) {
      const cls = classes.find((c) => c.id === targetClassId);
      allowedNames = cls?.allowedTools || cls?.defaultAllowedTools || [];
    } else if (scope === 'instance' && targetInstanceId) {
      const inst = instances.find((i) => i.id === targetInstanceId);
      allowedNames = inst?.instanceOverrides?.tools || inst?.tool_overrides || [];
      if (allowedNames.length === 0 && inst) {
        const parentCls = classes.find((c) => c.id === (inst.classId || inst.class_id));
        allowedNames = parentCls?.allowedTools || parentCls?.defaultAllowedTools || [];
      }
    }

    if (allowedNames.length === 0) {
      return Array.from(allToolsMap.values());
    }

    const filtered: BankTool[] = [];
    allowedNames.forEach((name) => {
      if (allToolsMap.has(name)) {
        filtered.push(allToolsMap.get(name)!);
      } else {
        filtered.push({ id: name, name, description: `Tool ${name}`, exposed: true });
      }
    });
    return filtered;
  }, [scope, targetClassId, targetInstanceId, classes, instances, connections]);

  // Available instances filtered by class if class selected
  const availableInstances = useMemo(() => {
    let list = instances;
    if (targetClassId) {
      list = instances.filter((i) => (i.classId || i.class_id) === targetClassId || i.id.startsWith(targetClassId));
    }
    if (targetInstanceId && !list.some((i) => i.id === targetInstanceId)) {
      list = [
        {
          id: targetInstanceId,
          classId: targetClassId || 'custom',
          class_id: targetClassId || 'custom',
          status: 'active',
          spendToday: 0,
          capToday: 0,
          lastAction: '',
          lastSeen: '',
        },
        ...list,
      ];
    }
    return list;
  }, [instances, targetClassId, targetInstanceId]);

  // Available classes ensuring targetClassId is always selectable
  const availableClasses = useMemo(() => {
    let list = classes;
    if (targetClassId && !list.some((c) => c.id === targetClassId)) {
      list = [
        {
          id: targetClassId,
          name: targetClassId,
          description: 'Custom class',
          allowedTools: [],
          defaultConstraints: {},
          defaultCap: { amount: 0, window: 'day' },
          instanceCount: 0,
        },
        ...list,
      ];
    }
    return list;
  }, [classes, targetClassId]);

  // Active Tool Definition & Schema
  const currentToolDef = useMemo(() => {
    return allowedToolsForTarget.find((t) => t.name === rule.action);
  }, [allowedToolsForTarget, rule.action]);

  // Schema properties map: { fieldName: { type, title, description } }
  const schemaProps = useMemo(() => {
    const schema = currentToolDef?.input_schema as any;
    if (schema && schema.properties && typeof schema.properties === 'object') {
      return schema.properties as Record<string, { type?: string; title?: string; description?: string }>;
    }
    return {};
  }, [currentToolDef]);

  // Sync default values for interactive test runner payload
  const [testFormValues, setTestFormValues] = useState<Record<string, any>>({
    amount_cents: 150000,
    recipient_account: '1000000002',
    is_external: true,
  });

  const [runnerViewMode, setRunnerViewMode] = useState<'form' | 'json'>('form');
  const [testPayloadStr, setTestPayloadStr] = useState('');

  // Sync testFormValues with JSON payload string
  useEffect(() => {
    const fullPayload = {
      action: rule.action,
      arguments: testFormValues,
      allowed_tools: allowedToolsForTarget.map((t) => t.name),
    };
    setTestPayloadStr(JSON.stringify(fullPayload, null, 2));
  }, [testFormValues, rule.action, allowedToolsForTarget]);

  const [testResult, setTestResult] = useState<{
    allowed: boolean;
    decision: string;
    reasons: string[];
    rego_source: string;
  } | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    if (isNew) {
      setName('');
      setScope('global');
      setTargetClassId('');
      setTargetInstanceId('');
      setMode('visual');
      const initialRule: VisualRule = {
        action: allowedToolsForTarget[0]?.name || 'transfer_money',
        conditions: [{ field: 'amount_cents', operator: 'gt', value: 100000 }],
      };
      setRule(initialRule);
      api.compileVisualRules([initialRule]).then((res) => {
        if (res.rego_source) setRegoSource(res.rego_source);
      }).catch(() => {});
      setValidationResult(null);
      setTestResult(null);
    } else if (policy) {
      setName(policy.name || '');
      setScope(policy.scope || 'global');
      const tId = policy.targetId || policy.target_id || '';
      if (policy.scope === 'class') {
        setTargetClassId(tId);
        setTargetInstanceId('');
      } else if (policy.scope === 'instance') {
        setTargetInstanceId(tId);
        const inst = instances.find((i) => i.id === tId);
        if (inst) {
          setTargetClassId(inst.classId || inst.class_id || '');
        } else {
          const matchedClass = classes.find((c) => tId.startsWith(c.id));
          if (matchedClass) {
            setTargetClassId(matchedClass.id);
          }
        }
      } else {
        setTargetClassId('');
        setTargetInstanceId('');
      }

      setMode(policy.type === 'rego' ? 'rego' : 'visual');
      setRegoSource(policy.regoSource || policy.rego_source || '');

      // Load visual rules from policy
      const vRules = policy.visualRules || policy.visual_rules || (policy.visualRule ? [policy.visualRule] : []);
      if (Array.isArray(vRules) && vRules.length > 0) {
        setRule(vRules[0]);
      }

      setValidationResult(null);
      setTestResult(null);
    }
  }, [policy, isNew, instances, classes]);

  // Sync Visual Rule changes to auto-generated Rego code
  const handleRuleChange = async (updatedRule: VisualRule) => {
    setRule(updatedRule);
    try {
      const compiled = await api.compileVisualRules([updatedRule]);
      if (compiled.rego_source) {
        setRegoSource(compiled.rego_source);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleValidate = async () => {
    try {
      const res = await api.validatePolicy(regoSource);
      if (res.valid) {
        setValidationResult({
          ok: true,
          message: 'Rego syntax valid — 0 syntax errors.',
        });
      } else {
        setValidationResult({
          ok: false,
          message: res.errors?.join(', ') || 'Rego syntax error found.',
        });
      }
    } catch (err: any) {
      setValidationResult({ ok: false, message: err.message || 'Validation error' });
    }
  };

  const handleRunTestcase = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      let parsedPayload: any;
      if (runnerViewMode === 'form') {
        parsedPayload = {
          action: rule.action,
          arguments: testFormValues,
          allowed_tools: allowedToolsForTarget.map((t) => t.name),
        };
      } else {
        parsedPayload = JSON.parse(testPayloadStr);
      }

      const res = await api.testPolicyInput({
        rego_source: mode === 'rego' ? regoSource : undefined,
        visual_rules: mode === 'visual' ? [rule] : undefined,
        input_payload: parsedPayload,
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        allowed: false,
        decision: 'DENY',
        reasons: [`Invalid Testcase Input: ${err.message}`],
        rego_source: regoSource,
      });
    } finally {
      setTestLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!policy?.id) return;
    setLoading(true);
    try {
      await api.deletePolicy(policy.id.toString());
      if (onRefresh) onRefresh();
      if (onCancel) onCancel();
    } catch (err: any) {
      setValidationResult({ ok: false, message: err.message || 'Failed to delete policy' });
    } finally {
      setLoading(false);
      setConfirmDelete(false);
    }
  };

  const handleSave = async (status: 'draft' | 'active') => {
    setLoading(true);
    setValidationResult(null);
    try {
      const finalTargetId = scope === 'global' ? null : scope === 'class' ? (targetClassId || null) : (targetInstanceId || null);
      const payload = {
        name: name || policy?.name || 'custom_governance_policy',
        scope: scope,
        target_id: finalTargetId,
        type: mode,
        rego_source: regoSource,
        visual_rules: [rule],
        status: status,
      };

      let savedPolicy: Policy | undefined;
      if (policy && policy.id) {
        savedPolicy = await api.updatePolicy(policy.id.toString(), payload as any);
      } else {
        savedPolicy = await api.createPolicy(payload as any);
      }
      if (onRefresh) onRefresh();
      if (onComplete) onComplete(savedPolicy);
    } catch (err: any) {
      setValidationResult({ ok: false, message: err.message || 'Failed to save policy' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel
      title={isNew ? 'New Governance Policy' : policy?.name ?? 'Policy'}
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. High-Value Payment Parameter Guard"
              className="mt-1 border-border bg-white/5 font-mono text-sm"
            />
          </div>
        )}

        {/* Scope & Target Selector */}
        <div className="mb-4 space-y-3 border border-border bg-white/5 p-3">
          <div>
            <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
              Governance Scope Level
            </Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setScope('global')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs transition-colors border',
                  scope === 'global' ? 'border-accent bg-accent/20 text-accent font-medium' : 'border-white/10 bg-white/5 text-ink-secondary hover:text-white'
                )}
              >
                <Shield className="h-3.5 w-3.5" /> Global Platform Policy
              </button>

              <button
                type="button"
                onClick={() => setScope('class')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs transition-colors border',
                  scope === 'class' ? 'border-accent bg-accent/20 text-accent font-medium' : 'border-white/10 bg-white/5 text-ink-secondary hover:text-white'
                )}
              >
                <Layers className="h-3.5 w-3.5" /> Agent Class Baseline
              </button>

              <button
                type="button"
                onClick={() => setScope('instance')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs transition-colors border',
                  scope === 'instance' ? 'border-accent bg-accent/20 text-accent font-medium' : 'border-white/10 bg-white/5 text-ink-secondary hover:text-white'
                )}
              >
                <User className="h-3.5 w-3.5" /> Specific Agent Instance
              </button>
            </div>
          </div>

          {/* Scope Explanatory Guidance */}
          <div className="font-mono text-[10px] text-ink-secondary bg-slate-950 p-2 border border-white/5">
            {scope === 'global' && '• Global Scope: Applies platform-wide across all agent classes, instances, and tools.'}
            {scope === 'class' && '• Class Scope: Sets a baseline policy for ALL agent instances that belong to the selected Agent Class.'}
            {scope === 'instance' && '• Instance Scope: Appends an instance-specific policy override to the selected agent instance.'}
          </div>

          {/* Target Selectors */}
          {scope !== 'global' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1">
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                  Target Agent Class
                </Label>
                <Select value={targetClassId} onValueChange={(v) => { setTargetClassId(v); setTargetInstanceId(''); }}>
                  <SelectTrigger className="mt-1 border-white/10 bg-slate-900 font-mono text-xs">
                    <SelectValue placeholder="Select Agent Class" />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-slate-900 text-white">
                    {availableClasses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {scope === 'instance' && (
                <div>
                  <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                    Target Agent Instance
                  </Label>
                  <Select value={targetInstanceId} onValueChange={setTargetInstanceId}>
                    <SelectTrigger className="mt-1 border-white/10 bg-slate-900 font-mono text-xs">
                      <SelectValue placeholder="Select Specific Instance" />
                    </SelectTrigger>
                    <SelectContent className="border-border bg-slate-900 text-white">
                      {availableInstances.map((inst) => (
                        <SelectItem key={inst.id} value={inst.id}>
                          {inst.id} ({inst.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Policy Editor Mode Tabs */}
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'visual' | 'rego')}>
          <TabsList className="border border-border bg-white/5">
            <TabsTrigger
              value="visual"
              className="data-[state=active]:bg-surface data-[state=active]:text-accent font-mono text-xs"
            >
              <Pencil className="mr-1.5 h-3 w-3" />
              Visual Condition Builder (Auto-Rego Sync)
            </TabsTrigger>
            <TabsTrigger
              value="rego"
              className="data-[state=active]:bg-surface data-[state=active]:text-accent font-mono text-xs"
            >
              <Code2 className="mr-1.5 h-3 w-3" />
              Rego Code Editor
            </TabsTrigger>
          </TabsList>

          <TabsContent value="visual">
            <VisualRuleBuilder
              rule={rule}
              setRule={handleRuleChange}
              allowedTools={allowedToolsForTarget}
              schemaProps={schemaProps}
            />
          </TabsContent>

          <TabsContent value="rego">
            <RegoEditor source={regoSource} setSource={setRegoSource} />
          </TabsContent>
        </Tabs>

        {/* Interactive Policy Testcase Runner Panel */}
        <div className="mt-4 border border-border bg-bg-deep/80 p-3">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-accent" />
              <span className="font-mono text-xs uppercase tracking-widest text-ink-primary font-semibold">
                Interactive Testcase Input Runner
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* Runner View Mode Switch */}
              <div className="flex items-center border border-white/10 bg-white/5 p-0.5 font-mono text-[10px]">
                <button
                  type="button"
                  onClick={() => setRunnerViewMode('form')}
                  className={cn(
                    'px-2 py-0.5 uppercase transition-colors',
                    runnerViewMode === 'form' ? 'bg-accent/20 text-accent font-semibold' : 'text-ink-secondary hover:text-white'
                  )}
                >
                  Visual Form
                </button>
                <button
                  type="button"
                  onClick={() => setRunnerViewMode('json')}
                  className={cn(
                    'px-2 py-0.5 uppercase transition-colors',
                    runnerViewMode === 'json' ? 'bg-accent/20 text-accent font-semibold' : 'text-ink-secondary hover:text-white'
                  )}
                >
                  Raw JSON
                </button>
              </div>

              <Button
                onClick={handleRunTestcase}
                disabled={testLoading}
                className="bg-accent/20 text-accent hover:bg-accent/30 font-mono text-xs h-7"
              >
                <Play className="mr-1 h-3 w-3" />
                {testLoading ? 'Evaluating...' : 'Run Testcase'}
              </Button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Input Panel: Form vs JSON */}
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                Test Input — Tool Parameters ({rule.action})
              </Label>

              {runnerViewMode === 'form' ? (
                <div className="mt-1 h-[160px] overflow-auto border border-border bg-slate-950 p-2 space-y-2">
                  {Object.keys(schemaProps).length > 0 ? (
                    Object.entries(schemaProps).map(([pName, pSpec]) => (
                      <div key={pName} className="flex items-center justify-between gap-2 border-b border-white/5 pb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-ink-primary font-medium">{pName}</span>
                          <span className="font-mono text-[9px] text-ink-secondary/70">({pSpec.type || 'any'})</span>
                        </div>

                        {pSpec.type === 'boolean' ? (
                          <Select
                            value={String(testFormValues[pName] ?? false)}
                            onValueChange={(v) => setTestFormValues({ ...testFormValues, [pName]: v === 'true' })}
                          >
                            <SelectTrigger className="h-6 w-[90px] border-white/10 bg-white/5 font-mono text-[11px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="border-border bg-slate-900 text-white">
                              <SelectItem value="true">true</SelectItem>
                              <SelectItem value="false">false</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : pSpec.type === 'integer' || pSpec.type === 'number' ? (
                          <Input
                            type="number"
                            value={testFormValues[pName] ?? 0}
                            onChange={(e) => setTestFormValues({ ...testFormValues, [pName]: parseFloat(e.target.value) || 0 })}
                            className="h-6 w-[120px] border-white/10 bg-white/5 font-mono text-[11px]"
                          />
                        ) : (
                          <Input
                            type="text"
                            value={testFormValues[pName] ?? ''}
                            onChange={(e) => setTestFormValues({ ...testFormValues, [pName]: e.target.value })}
                            className="h-6 w-[140px] border-white/10 bg-white/5 font-mono text-[11px]"
                          />
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-ink-primary">amount_cents</span>
                        <Input
                          type="number"
                          value={testFormValues.amount_cents ?? 150000}
                          onChange={(e) => setTestFormValues({ ...testFormValues, amount_cents: parseFloat(e.target.value) || 0 })}
                          className="h-6 w-[120px] border-white/10 bg-white/5 font-mono text-[11px]"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-ink-primary">recipient_account</span>
                        <Input
                          type="text"
                          value={testFormValues.recipient_account ?? '1000000002'}
                          onChange={(e) => setTestFormValues({ ...testFormValues, recipient_account: e.target.value })}
                          className="h-6 w-[140px] border-white/10 bg-white/5 font-mono text-[11px]"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-ink-primary">is_external</span>
                        <Select
                          value={String(testFormValues.is_external ?? true)}
                          onValueChange={(v) => setTestFormValues({ ...testFormValues, is_external: v === 'true' })}
                        >
                          <SelectTrigger className="h-6 w-[90px] border-white/10 bg-white/5 font-mono text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="border-border bg-slate-900 text-white">
                            <SelectItem value="true">true</SelectItem>
                            <SelectItem value="false">false</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <textarea
                  value={testPayloadStr}
                  onChange={(e) => setTestPayloadStr(e.target.value)}
                  spellCheck={false}
                  className="mt-1 h-[160px] w-full resize-none border border-border bg-slate-950 p-2 font-mono text-[11px] text-ink-primary outline-none"
                />
              )}
            </div>

            {/* Output Panel */}
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                Evaluation Output & Verdict
              </Label>
              <div className="mt-1 h-[160px] overflow-auto border border-border bg-slate-950 p-3 font-mono text-xs">
                {testResult ? (
                  <div>
                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-ink-secondary text-[11px]">Verdict:</span>
                        <span
                          className={cn(
                            'px-2.5 py-0.5 font-bold uppercase text-xs rounded-sm',
                            testResult.allowed
                              ? 'bg-signal-healthy/20 text-signal-healthy border border-signal-healthy/30'
                              : 'bg-signal-stopped/20 text-signal-stopped border border-signal-stopped/30'
                          )}
                        >
                          {testResult.decision}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 text-ink-secondary text-[11px] space-y-1">
                      <span className="font-semibold text-white/80">Evaluated Rule Output:</span>
                      {testResult.reasons.map((r, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-white/90">
                          <span>•</span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-ink-secondary/50 text-[11px] italic">
                    Click 'Run Testcase' to simulate policy evaluation on your input parameters.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Validate Code Action */}
        <div className="mt-4 flex items-center gap-2 border-t border-white/5 pt-4">
          <Button
            onClick={handleValidate}
            variant="outline"
            className="border-border text-ink-primary hover:bg-white/5 font-mono text-xs"
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            Validate Rego Syntax
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
                <XCircle className="h-4 w-4 font-bold text-rose-400" />
              )}
              {validationResult.message}
            </span>
          )}
        </div>

        {/* Save / Activate / Delete */}
        <div className="mt-4 flex justify-between">
          {/* Delete (left side) — only for existing policies and users with archive permission */}
          <div>
            {policy && policy.id && !isNew && canArchive && (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-red-400">Delete this policy?</span>
                  <Button
                    onClick={handleDelete}
                    disabled={loading}
                    className="bg-red-600 text-white hover:bg-red-700 font-mono text-xs"
                  >
                    Confirm Delete
                  </Button>
                  <Button
                    onClick={() => setConfirmDelete(false)}
                    variant="ghost"
                    className="text-ink-secondary font-mono text-xs"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => setConfirmDelete(true)}
                  variant="ghost"
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10 font-mono text-xs"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete
                </Button>
              )
            )}
          </div>

          {/* Save / Activate (right side) */}
          <div className="flex gap-2">
            {onCancel && (
              <Button
                onClick={onCancel}
                variant="ghost"
                className="border-border text-ink-secondary hover:bg-white/5 font-mono text-xs"
              >
                Cancel
              </Button>
            )}

            {!canEdit ? (
              <div className="flex items-center gap-1.5 px-3 py-1 font-mono text-xs text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded">
                <Eye className="h-3.5 w-3.5" />
                Read-Only (Auditor View)
              </div>
            ) : (
              <>
                {/* Only show Save Draft for new or draft policies */}
                {(isNew || policy?.status !== 'active') && (
                  <Button
                    onClick={() => handleSave('draft')}
                    disabled={loading}
                    variant="outline"
                    className="border-border text-ink-secondary font-mono text-xs"
                  >
                    Save draft
                  </Button>
                )}
                <Button
                  onClick={() => handleSave('active')}
                  disabled={loading}
                  className="bg-signal-healthy text-black hover:bg-signal-healthy/90 font-mono text-xs font-semibold"
                >
                  {policy?.status === 'active' ? 'Save & Keep Active' : 'Activate Policy'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function VisualRuleBuilder({
  rule,
  setRule,
  allowedTools,
  schemaProps,
}: {
  rule: VisualRule;
  setRule: (r: VisualRule) => void;
  allowedTools: BankTool[];
  schemaProps: Record<string, { type?: string; title?: string; description?: string }>;
}) {
  const schemaFields = useMemo(() => {
    const keys = Object.keys(schemaProps);
    if (keys.length > 0) return keys;
    return ['amount_cents', 'account_id', 'recipient_account', 'label', 'category', 'is_external', 'query'];
  }, [schemaProps]);

  // Helper to filter operators based on schema data type
  const getOperatorsForField = (field: string) => {
    const pType = schemaProps[field]?.type || 'any';
    if (pType === 'integer' || pType === 'number') {
      return [
        { label: '== (Equals)', value: 'eq' as RuleCondition['operator'] },
        { label: '!= (Not Equal)', value: 'ne' as RuleCondition['operator'] },
        { label: '> (Greater)', value: 'gt' as RuleCondition['operator'] },
        { label: '>= (Greater or Equal)', value: 'gte' as RuleCondition['operator'] },
        { label: '< (Less)', value: 'lt' as RuleCondition['operator'] },
        { label: '<= (Less or Equal)', value: 'lte' as RuleCondition['operator'] },
      ];
    }
    if (pType === 'boolean') {
      return [
        { label: '== (Equals)', value: 'eq' as RuleCondition['operator'] },
        { label: '!= (Not Equal)', value: 'ne' as RuleCondition['operator'] },
      ];
    }
    return [
      { label: '== (Equals)', value: 'eq' as RuleCondition['operator'] },
      { label: '!= (Not Equal)', value: 'ne' as RuleCondition['operator'] },
      { label: 'Regex Deny (Blacklist)', value: 'regex_deny' as RuleCondition['operator'] },
      { label: 'Regex Allow (Whitelist)', value: 'regex_allow' as RuleCondition['operator'] },
      { label: 'Contains', value: 'contains' as RuleCondition['operator'] },
      { label: 'In List', value: 'in_list' as RuleCondition['operator'] },
    ];
  };

  const addCondition = () => {
    const defaultField = schemaFields[0] || 'amount_cents';
    setRule({
      ...rule,
      conditions: [...rule.conditions, { field: defaultField, operator: 'gt', value: 100000 }],
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary mb-1 block">
            Target Scoped Tool Action ({allowedTools.length} tools available)
          </Label>
          <Select value={rule.action} onValueChange={(v) => setRule({ ...rule, action: v })}>
            <SelectTrigger className="w-full border-white/10 bg-slate-900 font-mono text-xs">
              <SelectValue placeholder="Select Tool Action" />
            </SelectTrigger>
            <SelectContent className="border-border bg-slate-900 text-white max-h-[280px]">
              <SelectItem value="*">* (All Scoped Tools)</SelectItem>
              {allowedTools.map((t) => (
                <SelectItem key={t.name} value={t.name} className="py-1.5">
                  <div className="flex flex-col text-left">
                    <span className="font-mono text-xs text-white font-medium">{t.name}</span>
                    {t.description && (
                      <span className="font-sans text-[10px] text-ink-secondary/70 truncate max-w-[260px]">
                        {t.description}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary mb-1 block">
            Policy Enforcement Effect
          </Label>
          <Select value={rule.effect || 'deny'} onValueChange={(v) => setRule({ ...rule, effect: v as any })}>
            <SelectTrigger className="w-full border-white/10 bg-slate-900 font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-border bg-slate-900 text-white">
              <SelectItem value="deny">DENY (Block execution if conditions match)</SelectItem>
              <SelectItem value="allow">ALLOW (Permit execution if conditions match)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            Parameter Constraints on Schema ({rule.action})
          </Label>
          <button
            type="button"
            onClick={addCondition}
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-accent hover:underline"
          >
            <Plus className="h-3 w-3" /> Add parameter rule
          </button>
        </div>
        <div className="mt-1.5 space-y-2">
          {rule.conditions.map((cond, idx) => {
            const fieldType = schemaProps[cond.field]?.type || 'any';
            const availableOperators = getOperatorsForField(cond.field);

            return (
              <div key={idx} className="flex items-center gap-2">
                {/* Schema Parameter Selector */}
                <Select value={cond.field} onValueChange={(v) => updateCondition(idx, { field: v })}>
                  <SelectTrigger className="w-[180px] border-white/10 bg-slate-900 font-mono text-xs">
                    <SelectValue placeholder="Select parameter" />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-slate-900 text-white">
                    {schemaFields.map((fName) => (
                      <SelectItem key={fName} value={fName}>
                        {fName} <span className="text-ink-secondary/60 text-[10px]">({schemaProps[fName]?.type || 'any'})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* DataType-Specific Operator Selector */}
                <Select
                  value={cond.operator}
                  onValueChange={(v) => updateCondition(idx, { operator: v as RuleCondition['operator'] })}
                >
                  <SelectTrigger className="w-[170px] border-white/10 bg-slate-900 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-slate-900 text-white">
                    {availableOperators.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Constraint Value Input */}
                <Input
                  value={String(cond.value)}
                  onChange={(e) => updateCondition(idx, { value: e.target.value })}
                  className="flex-1 border-white/10 bg-slate-900 font-mono text-xs"
                  placeholder={fieldType === 'boolean' ? 'true or false' : 'Target value or regex pattern'}
                />

                <button
                  type="button"
                  onClick={() => removeCondition(idx)}
                  className="text-ink-secondary hover:text-signal-stopped"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              </div>
            );
          })}
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
  const [tab, setTab] = useState<'editor' | 'preview'>('editor');

  const renderHighlightedCode = (code: string) => {
    const lines = code.split('\n');
    const keywords = ['package', 'import', 'default', 'allow', 'deny', 'if', 'else', 'some', 'every', 'not', 'in'];
    return lines.map((line, i) => {
      if (line.trim().startsWith('#')) {
        return (
          <div key={i} className="text-ink-secondary/50 italic">
            {line}
          </div>
        );
      }
      const parts = line.split(/(\bpackage\b|\bimport\b|\bdefault\b|\ballow\b|\bdeny\b|\bif\b|\belse\b|\bsome\b|\bevery\b|\bnot\b|\bin\b|"[^"]*"|\b\d+\b)/g);
      return (
        <div key={i} className="whitespace-pre">
          {parts.map((part, j) => {
            if (keywords.includes(part)) {
              return <span key={j} className="font-semibold text-accent">{part}</span>;
            }
            if (part && part.startsWith('"') && part.endsWith('"')) {
              return <span key={j} className="text-signal-healthy">{part}</span>;
            }
            if (part && /^\d+$/.test(part)) {
              return <span key={j} className="text-signal-caution">{part}</span>;
            }
            return <span key={j}>{part}</span>;
          })}
        </div>
      );
    });
  };

  return (
    <div className="border border-border bg-bg-deep">
      <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <FileJson className="h-3.5 w-3.5 text-ink-secondary" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
            policy.rego
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab('editor')}
            className={cn(
              'px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
              tab === 'editor' ? 'bg-accent/20 text-accent' : 'text-ink-secondary hover:text-ink-primary'
            )}
          >
            Edit Rego Code
          </button>
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={cn(
              'px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
              tab === 'preview' ? 'bg-accent/20 text-accent' : 'text-ink-secondary hover:text-ink-primary'
            )}
          >
            Highlight Preview
          </button>
        </div>
      </div>
      {tab === 'editor' ? (
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          className="h-[280px] w-full resize-none bg-bg-deep p-3 font-mono text-xs leading-relaxed text-ink-primary outline-none"
        />
      ) : (
        <div className="h-[280px] overflow-auto bg-bg-deep p-3 font-mono text-xs leading-relaxed text-ink-primary">
          {renderHighlightedCode(source)}
        </div>
      )}
    </div>
  );
}
