'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Mail,
  Lock,
  ShieldCheck,
  Shield,
  Info,
  Check,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DemoRole {
  id: 'admin' | 'operator' | 'auditor';
  label: string;
  email: string;
  pass: string;
  desc: string;
  badgeClass: string;
  icon: React.ComponentType<{ className?: string }>;
}

const DEMO_ROLES: DemoRole[] = [
  {
    id: 'admin',
    label: 'Admin',
    email: 'admin@reflex.local',
    pass: 'AdminPass123!',
    desc: 'Full governance, caps & policies',
    badgeClass: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
    icon: ShieldCheck,
  },
  {
    id: 'operator',
    label: 'Operator',
    email: 'operator@reflex.local',
    pass: 'OperatorPass123!',
    desc: 'Instances, tools & killswitches',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    icon: Shield,
  },
  {
    id: 'auditor',
    label: 'Auditor',
    email: 'auditor@reflex.local',
    pass: 'AuditorPass123!',
    desc: 'Read-only telemetry & audit logs',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    icon: Info,
  },
];

export function LoginView() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please provide both email and password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDemo = (role: DemoRole) => {
    setSelectedRole(role.id);
    setEmail(role.email);
    setPassword(role.pass);
    setError(null);
  };

  return (
    <div className="relative min-h-screen bg-bg-deep text-ink-primary flex flex-col items-center justify-center p-4 antialiased selection:bg-accent/30 selection:text-white">
      {/* Background ambient lighting */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(76,141,255,0.08),transparent_70%)]" />

      <div className="relative w-full max-w-[420px] z-10 flex flex-col gap-5">
        {/* Brand Header — Matches AppShell sidebar branding */}
        <div className="flex flex-col items-center text-center gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-mono font-bold text-white text-sm shadow-lg shadow-blue-500/20 border border-white/20">
              AGP
            </div>
            <div className="text-left">
              <div className="font-mono font-bold text-base text-white tracking-tight flex items-center gap-2">
                REFLEX AGP
                <span className="px-1.5 py-0.2 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono text-[9px] font-semibold uppercase tracking-wide">
                  LIVE
                </span>
              </div>
              <div className="text-[11px] font-mono text-ink-secondary">
                AI Governance Control Plane
              </div>
            </div>
          </div>
        </div>

        {/* Login Glass Card */}
        <div className="glass glass-edge glass-strong rounded-2xl p-6 sm:p-7 shadow-2xl relative">
          {/* Top highlight bar */}
          <div className="flex items-center justify-between pb-4 mb-5 border-b border-white/[0.06]">
            <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-white flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-accent" /> Control Center Access
            </h2>
            <span className="font-mono text-[10px] text-ink-secondary">
              Session Auth
            </span>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-signal-stopped/10 border border-signal-stopped/25 font-mono text-xs text-signal-stopped flex items-start gap-2.5">
              <span className="w-2 h-2 rounded-full bg-signal-stopped shrink-0 mt-1" />
              <span className="flex-1 leading-relaxed">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div className="space-y-1.5">
              <label className="block font-mono text-[10px] font-semibold text-ink-secondary uppercase tracking-wider">
                Operator Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-ink-secondary/50 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setSelectedRole(null);
                  }}
                  placeholder="operator@reflex.local"
                  className="w-full bg-surface-solid/80 border border-white/[0.08] focus:border-accent focus:ring-1 focus:ring-accent/30 rounded-xl pl-10 pr-3.5 py-2.5 font-mono text-xs text-ink-primary placeholder:text-ink-secondary/40 outline-none transition-all"
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label className="block font-mono text-[10px] font-semibold text-ink-secondary uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-ink-secondary/50 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setSelectedRole(null);
                  }}
                  placeholder="••••••••••••"
                  className="w-full bg-surface-solid/80 border border-white/[0.08] focus:border-accent focus:ring-1 focus:ring-accent/30 rounded-xl pl-10 pr-10 py-2.5 font-mono text-xs text-ink-primary placeholder:text-ink-secondary/40 outline-none transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-secondary/50 hover:text-ink-primary p-1 transition-colors cursor-pointer"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Sign In Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-accent hover:bg-accent/90 text-white font-mono text-xs font-semibold py-2.5 px-4 rounded-xl shadow-md shadow-accent/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Authenticating...
                </span>
              ) : (
                <>
                  <span>Sign In to Control Center</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>

          {/* Demo Accounts Section */}
          <div className="mt-6 pt-5 border-t border-white/[0.06] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-ink-secondary font-semibold flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-accent" /> Demo Accounts
              </span>
              <span className="font-mono text-[10px] text-ink-secondary/60">
                Click to Auto-fill
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {DEMO_ROLES.map((role) => {
                const Icon = role.icon;
                const isSelected = selectedRole === role.id;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => handleSelectDemo(role)}
                    className={cn(
                      'w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition-all cursor-pointer font-mono group',
                      isSelected
                        ? 'border-accent/60 bg-accent/10 shadow-sm shadow-accent/10'
                        : 'border-white/[0.05] bg-surface-glass hover:bg-surface-glass-hover hover:border-white/10'
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={cn('px-1.5 py-0.5 rounded border font-mono text-[9px] font-bold uppercase flex items-center gap-1 shrink-0', role.badgeClass)}>
                        <Icon className="w-2.5 h-2.5" /> {role.label}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[11px] text-white font-medium truncate">
                          {role.email}
                        </div>
                        <div className="text-[10px] text-ink-secondary truncate">
                          {role.desc}
                        </div>
                      </div>
                    </div>

                    <div className="pl-2 shrink-0">
                      {isSelected ? (
                        <span className="w-5 h-5 rounded-full bg-accent/20 border border-accent flex items-center justify-center text-accent">
                          <Check className="w-3 h-3" />
                        </span>
                      ) : (
                        <span className="text-[10px] text-ink-secondary/50 group-hover:text-ink-secondary uppercase">
                          Select
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center font-mono text-[10px] text-ink-secondary/60 space-y-1">
          <div>Reflex Governance Gateway · Active Protection Active</div>
        </div>
      </div>
    </div>
  );
}
