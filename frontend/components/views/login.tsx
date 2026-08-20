'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ArrowRight, Eye, EyeOff, Mail, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

export function LoginView() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const fillQuickPreset = (role: string, presetEmail: string, presetPass: string) => {
    setSelectedPreset(role);
    setEmail(presetEmail);
    setPassword(presetPass);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-bg-deep text-ink-primary flex flex-col items-center justify-center p-4 font-sans antialiased">
      <div className="w-full max-w-[380px]">
        {/* Clean Minimal Title */}
        <div className="text-center mb-6">
          <h1 className="font-mono text-xl font-bold tracking-wider text-white">
            REFLEX
          </h1>
        </div>

        {/* Card */}
        <div className="rounded-xl bg-surface/50 border border-white/[0.06] p-6 shadow-2xl backdrop-blur-xl">
          {error && (
            <div className="mb-4 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 font-mono text-xs text-rose-300 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
              <span className="flex-1">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="space-y-1">
              <label className="block font-mono text-[10px] text-ink-secondary uppercase tracking-wider">
                Email
              </label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-ink-secondary/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@reflex.local"
                  className="w-full bg-black/40 border border-white/[0.06] focus:border-accent/60 focus:ring-1 focus:ring-accent/20 rounded-lg pl-8 pr-3 py-2 text-xs font-mono text-white placeholder:text-ink-secondary/30 transition-colors outline-none"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block font-mono text-[10px] text-ink-secondary uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-ink-secondary/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-black/40 border border-white/[0.06] focus:border-accent/60 focus:ring-1 focus:ring-accent/20 rounded-lg pl-8 pr-8 py-2 text-xs font-mono text-white placeholder:text-ink-secondary/30 transition-colors outline-none"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-secondary/50 hover:text-ink-primary p-0.5 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-accent hover:bg-accent/90 text-white font-mono text-xs font-semibold py-2.5 rounded-lg shadow-md shadow-blue-500/15 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <span>Signing in...</span>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>

          {/* Clean preset selector */}
          <div className="mt-5 pt-4 border-t border-white/[0.04]">
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => fillQuickPreset('admin', 'admin@reflex.local', 'AdminPass123!')}
                className={cn(
                  'py-1.5 px-2 rounded border text-center font-mono text-[11px] transition-colors cursor-pointer',
                  selectedPreset === 'admin'
                    ? 'border-accent/50 bg-accent/15 text-accent font-semibold'
                    : 'border-white/[0.04] bg-white/[0.02] text-ink-secondary hover:text-white hover:bg-white/[0.04]'
                )}
              >
                Admin
              </button>

              <button
                type="button"
                onClick={() => fillQuickPreset('operator', 'operator@reflex.local', 'OperatorPass123!')}
                className={cn(
                  'py-1.5 px-2 rounded border text-center font-mono text-[11px] transition-colors cursor-pointer',
                  selectedPreset === 'operator'
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400 font-semibold'
                    : 'border-white/[0.04] bg-white/[0.02] text-ink-secondary hover:text-white hover:bg-white/[0.04]'
                )}
              >
                Operator
              </button>

              <button
                type="button"
                onClick={() => fillQuickPreset('auditor', 'auditor@reflex.local', 'AuditorPass123!')}
                className={cn(
                  'py-1.5 px-2 rounded border text-center font-mono text-[11px] transition-colors cursor-pointer',
                  selectedPreset === 'auditor'
                    ? 'border-amber-400/50 bg-amber-400/15 text-amber-400 font-semibold'
                    : 'border-white/[0.04] bg-white/[0.02] text-ink-secondary hover:text-white hover:bg-white/[0.04]'
                )}
              >
                Auditor
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
