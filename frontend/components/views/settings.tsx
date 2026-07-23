'use client';

import { Panel, StatTile } from '@/components/gov/panel';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/format';
import { Bell, DollarSign, User, Mail, Shield } from 'lucide-react';

export function SettingsView({ operator }: { operator: string }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="font-mono text-sm uppercase tracking-widest text-ink-primary">
          Settings
        </h2>
        <p className="font-sans text-xs text-ink-secondary">
          Default spend cap templates, notification preferences, and operator profile.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Spend cap templates */}
        <Panel title="Default Spend Cap Templates">
          <div className="space-y-3 p-4">
            <p className="font-sans text-xs text-ink-secondary">
              Pre-configured cap templates that can be applied when creating or editing agent classes.
            </p>
            {[
              { name: 'Conservative', amount: 500000, window: 'day' },
              { name: 'Standard', amount: 2000000, window: 'day' },
              { name: 'High Volume', amount: 10000000, window: 'day' },
              { name: 'Monthly Operations', amount: 50000000, window: 'month' },
            ].map((tpl) => (
              <div
                key={tpl.name}
                className="flex items-center justify-between border border-border bg-white/5 p-3"
              >
                <div>
                  <div className="font-mono text-xs text-ink-primary">{tpl.name}</div>
                  <div className="font-mono text-[10px] text-ink-secondary tabular">
                    {formatCurrency(tpl.amount)} / {tpl.window}
                  </div>
                </div>
                <DollarSign className="h-4 w-4 text-ink-secondary" />
              </div>
            ))}
            <div className="flex items-center gap-2 border-t border-white/5 pt-3">
              <Input
                placeholder="Template name"
                className="border-border bg-white/5 font-mono text-xs"
              />
              <Input
                type="number"
                placeholder="Amount"
                className="w-24 border-border bg-white/5 font-mono text-xs tabular"
              />
              <Select defaultValue="day">
                <SelectTrigger className="w-24 border-border bg-white/5 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-white/5">
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Panel>

        {/* Notification preferences */}
        <Panel title="Notification Preferences">
          <div className="space-y-3 p-4">
            {[
              { label: 'Cap breach warnings (80%)', desc: 'Notify when any agent reaches 80% of its daily cap', defaultOn: true },
              { label: 'Agent revocation', desc: 'Notify when an agent is revoked or killed', defaultOn: true },
              { label: 'Policy changes', desc: 'Notify when a policy is activated or modified', defaultOn: true },
              { label: 'Fleet emergency stop', desc: 'Notify on any fleet-wide stop event', defaultOn: true },
              { label: 'Bank connection errors', desc: 'Notify when a bank connection enters error state', defaultOn: false },
              { label: 'Daily summary digest', desc: 'Email a daily summary at market close', defaultOn: false },
            ].map((pref) => (
              <div
                key={pref.label}
                className="flex items-center justify-between border border-border bg-white/5 p-3"
              >
                <div className="flex items-start gap-2.5">
                  <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-secondary" />
                  <div>
                    <div className="font-mono text-xs text-ink-primary">{pref.label}</div>
                    <div className="font-sans text-[11px] text-ink-secondary">{pref.desc}</div>
                  </div>
                </div>
                <Switch defaultChecked={pref.defaultOn} />
              </div>
            ))}
          </div>
        </Panel>

        {/* Operator profile */}
        <Panel title="Operator Profile" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center border border-accent/30 bg-accent/10">
                <User className="h-6 w-6 text-accent" />
              </div>
              <div>
                <div className="font-mono text-sm text-ink-primary">{operator}</div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                  Compliance Operator
                </div>
              </div>
            </div>
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                Email
              </Label>
              <div className="mt-1 flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-ink-secondary" />
                <span className="font-mono text-xs text-ink-primary">{operator}@bank.example</span>
              </div>
            </div>
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary">
                Role
              </Label>
              <div className="mt-1 flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-ink-secondary" />
                <span className="font-mono text-xs text-ink-primary">Full governance access</span>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
