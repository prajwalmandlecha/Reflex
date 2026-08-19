'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Shield, Lock, Mail, ArrowRight, UserCheck, Eye, EyeOff } from 'lucide-react';

export function LoginView() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const fillQuickPreset = (presetEmail: string, presetPass: string) => {
    setEmail(presetEmail);
    setPassword(presetPass);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-bg-deep text-ink-primary flex items-center justify-center p-4 font-sans antialiased">
      <div className="w-full max-w-md">
        {/* Header Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent font-mono font-bold text-white text-xl shadow-lg shadow-blue-500/20 mb-3 border border-blue-400/30">
            AGP
          </div>
          <h1 className="font-mono text-xl font-bold tracking-tight text-ink-primary">
            REFLEX GOVERNANCE PLATFORM
          </h1>
          <p className="text-xs font-mono text-ink-secondary mt-1">
            In-Flight Security Interceptor & Control Plane
          </p>
        </div>

        {/* Login Form Container */}
        <div className="bg-surface border border-border rounded-xl p-6 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2 border-b border-border pb-4 mb-6">
            <Shield className="w-4 h-4 text-accent" />
            <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-ink-primary">
              Operator Authentication
            </h2>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded bg-rose-500/10 border border-rose-500/30 font-mono text-xs text-rose-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block font-mono text-xs text-ink-secondary mb-1.5">
                Work Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-ink-secondary absolute left-3 top-3" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@organisation.com"
                  className="w-full bg-bg-deep border border-border rounded-lg pl-9 pr-3 py-2 text-xs font-mono text-ink-primary focus:outline-none focus:border-accent transition-colors"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block font-mono text-xs text-ink-secondary mb-1.5">
                Account Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-ink-secondary absolute left-3 top-3" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-bg-deep border border-border rounded-lg pl-9 pr-10 py-2 text-xs font-mono text-ink-primary focus:outline-none focus:border-accent transition-colors"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-ink-secondary hover:text-ink-primary"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-accent hover:bg-accent/90 text-white font-mono text-xs font-semibold py-2.5 rounded-lg transition-[background-color] shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <span className="animate-pulse">Authenticating...</span>
              ) : (
                <>
                  <span>Sign In to Control Center</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Seed Account Quick Login Helpers */}
          <div className="mt-6 pt-5 border-t border-border">
            <div className="font-mono text-[10px] uppercase text-ink-secondary mb-2 font-semibold">
              Demo Seed Accounts (Click to autofill)
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => fillQuickPreset('admin@reflex.local', 'AdminPass123!')}
                className="p-2 rounded border border-border bg-bg-deep/60 hover:border-blue-500/50 hover:bg-accent/10 text-left transition-colors font-mono"
              >
                <div className="text-xs text-accent font-bold">Admin</div>
                <div className="text-[10px] text-ink-secondary">Full System</div>
              </button>
              <button
                type="button"
                onClick={() => fillQuickPreset('operator@reflex.local', 'OperatorPass123!')}
                className="p-2 rounded border border-border bg-bg-deep/60 hover:border-emerald-500/50 hover:bg-emerald-500/10 text-left transition-colors font-mono"
              >
                <div className="text-xs text-emerald-400 font-bold">Operator</div>
                <div className="text-[10px] text-ink-secondary">Fleet & Policy</div>
              </button>
              <button
                type="button"
                onClick={() => fillQuickPreset('auditor@reflex.local', 'AuditorPass123!')}
                className="p-2 rounded border border-border bg-bg-deep/60 hover:border-amber-500/50 hover:bg-amber-500/10 text-left transition-colors font-mono"
              >
                <div className="text-xs text-amber-400 font-bold">Auditor</div>
                <div className="text-[10px] text-ink-secondary">Read Only</div>
              </button>
            </div>
          </div>
        </div>

        <div className="text-center mt-6 font-mono text-[11px] text-ink-secondary">
          Reflex Enterprise Security Interceptor • v1.0.0
        </div>
      </div>
    </div>
  );
}
