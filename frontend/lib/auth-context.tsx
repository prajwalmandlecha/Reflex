'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { PlatformUser, UserRole } from '@/lib/types';

interface AuthContextType {
  user: PlatformUser | null;
  permissions: Set<string>;
  token: string | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (perm: string) => boolean;
  hasRole: (role: UserRole | UserRole[]) => boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  permissions: new Set(),
  token: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  hasPermission: () => false,
  hasRole: () => false,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshProfile = useCallback(async () => {
    const storedToken = localStorage.getItem('reflex_auth_token');
    if (!storedToken) {
      setUser(null);
      setPermissions(new Set());
      setToken(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.getMe();
      if (res && res.user) {
        setUser(res.user);
        setPermissions(new Set(res.permissions || []));
        setToken(storedToken);
      } else {
        localStorage.removeItem('reflex_auth_token');
        setUser(null);
        setPermissions(new Set());
        setToken(null);
      }
    } catch {
      localStorage.removeItem('reflex_auth_token');
      setUser(null);
      setPermissions(new Set());
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  const login = async (email: string, pass: string) => {
    const res = await api.login(email, pass);
    if (res && res.token && res.user) {
      localStorage.setItem('reflex_auth_token', res.token);
      setToken(res.token);
      setUser(res.user);
      setPermissions(new Set(res.user.permissions || []));
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore network errors during logout
    } finally {
      localStorage.removeItem('reflex_auth_token');
      setUser(null);
      setPermissions(new Set());
      setToken(null);
    }
  };

  const hasPermission = (perm: string): boolean => {
    if (!user) return false;
    if (user.role === 'admin') return true; // Admin bypasses all checks
    return permissions.has(perm);
  };

  const hasRole = (role: UserRole | UserRole[]): boolean => {
    if (!user) return false;
    if (Array.isArray(role)) {
      return role.includes(user.role);
    }
    return user.role === role;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions,
        token,
        loading,
        login,
        logout,
        hasPermission,
        hasRole,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
