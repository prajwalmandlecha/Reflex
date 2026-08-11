'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { PlatformUser, UserRole } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import {
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Search,
  Key,
  Ban,
  CheckCircle,
  Trash2,
  Lock,
  Mail,
  User,
  RefreshCw,
  Info,
} from 'lucide-react';

export function UsersView() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'directory' | 'matrix'>('directory');
  const [roleMatrix, setRoleMatrix] = useState<any[]>([]);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState<PlatformUser | null>(null);

  // Add User Form State
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('operator');
  const [formError, setFormError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Reset Password Form State
  const [resetNewPass, setResetNewPass] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getUsers({
        query: searchQuery || undefined,
        role: roleFilter !== 'all' ? roleFilter : undefined,
      });
      setUsers(data || []);
    } catch (err: any) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, roleFilter]);

  const loadMatrix = useCallback(async () => {
    try {
      const res = await api.getRolePermissionsMatrix();
      if (res && res.roles) setRoleMatrix(res.roles);
    } catch (err) {
      console.error('Failed to load matrix:', err);
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadMatrix();
  }, [loadUsers, loadMatrix]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newName || !newPassword) {
      setFormError('Please fill out all required fields');
      return;
    }
    setFormError(null);
    setActionLoading(true);
    try {
      await api.createUser({
        email: newEmail,
        full_name: newName,
        password: newPassword,
        role: newRole,
      });
      setShowAddModal(false);
      setNewEmail('');
      setNewName('');
      setNewPassword('');
      setNewRole('operator');
      loadUsers();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create user');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateRole = async (userId: string, role: UserRole) => {
    try {
      await api.updateUser(userId, { role });
      loadUsers();
      if (showEditModal) setShowEditModal(null);
    } catch (err: any) {
      alert(err.message || 'Failed to update user role');
    }
  };

  const handleToggleSuspend = async (userId: string, currentStatus: string) => {
    const action = currentStatus === 'active' ? 'suspend' : 'activate';
    if (confirm(`Are you sure you want to ${action} this user?`)) {
      try {
        await api.suspendUser(userId, action);
        loadUsers();
      } catch (err: any) {
        alert(err.message || 'Failed to update user status');
      }
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showResetModal || !resetNewPass) return;
    setActionLoading(true);
    try {
      await api.resetUserPassword(showResetModal, resetNewPass);
      alert('Password reset successfully');
      setShowResetModal(null);
      setResetNewPass('');
    } catch (err: any) {
      alert(err.message || 'Failed to reset password');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (confirm(`Are you sure you want to permanently delete user '${email}'?`)) {
      try {
        await api.deleteUser(userId);
        loadUsers();
      } catch (err: any) {
        alert(err.message || 'Failed to delete user');
      }
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return (
          <span className="px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-400 font-mono text-[11px] font-semibold flex items-center gap-1 w-fit">
            <ShieldCheck className="w-3 h-3" /> Admin
          </span>
        );
      case 'operator':
        return (
          <span className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono text-[11px] font-semibold flex items-center gap-1 w-fit">
            <Shield className="w-3 h-3" /> Operator
          </span>
        );
      case 'auditor':
        return (
          <span className="px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 font-mono text-[11px] font-semibold flex items-center gap-1 w-fit">
            <Info className="w-3 h-3" /> Auditor
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#232B35] pb-4">
        <div>
          <h1 className="font-mono text-xl font-bold tracking-tight text-[#E4E9EE] flex items-center gap-2">
            <Users className="w-5 h-5 text-[#4C8DFF]" />
            User & Access Management
          </h1>
          <p className="text-xs font-mono text-[#8B96A3] mt-1">
            Manage organization users, role assignments, administrative privileges, and security status.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-[#131A22] border border-[#232B35] rounded-lg p-1">
            <button
              onClick={() => setActiveTab('directory')}
              className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                activeTab === 'directory'
                  ? 'bg-[#4C8DFF]/20 text-[#4C8DFF] font-semibold'
                  : 'text-[#8B96A3] hover:text-[#E4E9EE]'
              }`}
            >
              User Directory
            </button>
            <button
              onClick={() => setActiveTab('matrix')}
              className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                activeTab === 'matrix'
                  ? 'bg-[#4C8DFF]/20 text-[#4C8DFF] font-semibold'
                  : 'text-[#8B96A3] hover:text-[#E4E9EE]'
              }`}
            >
              3-Role Permission Matrix
            </button>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 rounded-lg bg-[#4C8DFF] hover:bg-[#4C8DFF]/90 text-white font-mono text-xs font-semibold flex items-center gap-2 shadow-md shadow-blue-500/20 transition-all"
          >
            <UserPlus className="w-4 h-4" />
            <span>Create User</span>
          </button>
        </div>
      </div>

      {activeTab === 'directory' ? (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#131A22] border border-[#232B35] p-3 rounded-lg">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-[#8B96A3] absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0B0F14] border border-[#232B35] rounded-lg pl-9 pr-3 py-1.5 text-xs font-mono text-[#E4E9EE] focus:outline-none focus:border-[#4C8DFF]"
              />
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-[#8B96A3]">Role:</span>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="bg-[#0B0F14] border border-[#232B35] rounded-lg px-2 py-1 text-xs font-mono text-[#E4E9EE]"
                >
                  <option value="all">All Roles</option>
                  <option value="admin">Admin</option>
                  <option value="operator">Operator</option>
                  <option value="auditor">Auditor</option>
                </select>
              </div>

              <button
                onClick={loadUsers}
                className="p-1.5 rounded border border-[#232B35] bg-[#0B0F14] text-[#8B96A3] hover:text-[#E4E9EE]"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Users Table */}
          <div className="border border-[#232B35] rounded-lg bg-[#131A22] overflow-hidden">
            {loading ? (
              <div className="p-8 text-center font-mono text-xs text-[#8B96A3]">Loading users...</div>
            ) : users.length === 0 ? (
              <div className="p-8 text-center font-mono text-xs text-[#8B96A3]">
                No users found matching query filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-[#0B0F14]/80 border-b border-[#232B35] text-[#8B96A3] uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-4">User Identity</th>
                      <th className="py-3 px-4">System Role</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Last Login</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#232B35]/50">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-[#232B35]/30 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[#E4E9EE]">{u.full_name}</div>
                          <div className="text-[11px] text-[#8B96A3]">{u.email}</div>
                        </td>
                        <td className="py-3 px-4">{getRoleBadge(u.role)}</td>
                        <td className="py-3 px-4">
                          {u.status === 'active' ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px]">
                              Active
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[10px]">
                              Suspended
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[#8B96A3]">
                          {u.last_login_at
                            ? new Date(u.last_login_at).toLocaleString()
                            : 'Never'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <select
                              value={u.role}
                              onChange={(e) => handleUpdateRole(u.id, e.target.value as UserRole)}
                              disabled={u.id === currentUser?.id}
                              className="bg-[#0B0F14] border border-[#232B35] rounded px-2 py-1 text-[11px] font-mono text-[#E4E9EE] disabled:opacity-50"
                              title="Change Role"
                            >
                              <option value="admin">Admin</option>
                              <option value="operator">Operator</option>
                              <option value="auditor">Auditor</option>
                            </select>

                            <button
                              onClick={() => setShowResetModal(u.id)}
                              className="p-1 rounded border border-[#232B35] bg-[#0B0F14] text-[#8B96A3] hover:text-[#4C8DFF]"
                              title="Reset Password"
                            >
                              <Key className="w-3.5 h-3.5" />
                            </button>

                            {u.id !== currentUser?.id && (
                              <>
                                <button
                                  onClick={() => handleToggleSuspend(u.id, u.status)}
                                  className={`p-1 rounded border border-[#232B35] bg-[#0B0F14] ${
                                    u.status === 'active'
                                      ? 'text-[#8B96A3] hover:text-amber-400'
                                      : 'text-amber-400 hover:text-emerald-400'
                                  }`}
                                  title={u.status === 'active' ? 'Suspend Account' : 'Reactivate Account'}
                                >
                                  {u.status === 'active' ? (
                                    <Ban className="w-3.5 h-3.5" />
                                  ) : (
                                    <CheckCircle className="w-3.5 h-3.5" />
                                  )}
                                </button>

                                <button
                                  onClick={() => handleDeleteUser(u.id, u.email)}
                                  className="p-1 rounded border border-[#232B35] bg-[#0B0F14] text-[#8B96A3] hover:text-rose-400"
                                  title="Delete User"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 3-Role Permissions Matrix View */
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {roleMatrix.map((r) => (
              <div
                key={r.id}
                className="bg-[#131A22] border border-[#232B35] rounded-xl p-5 space-y-3"
              >
                <div className="flex items-center justify-between border-b border-[#232B35] pb-3">
                  <h3 className="font-mono text-sm font-bold text-[#E4E9EE]">{r.name}</h3>
                  {getRoleBadge(r.id)}
                </div>
                <p className="text-xs text-[#8B96A3] leading-relaxed">{r.description}</p>
                <div className="pt-2">
                  <div className="font-mono text-[10px] uppercase text-[#8B96A3] mb-2 font-bold">
                    Granted Permissions ({r.permissions.length}):
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-48 overflow-y-auto pr-1">
                    {r.permissions.map((p: string) => (
                      <span
                        key={p}
                        className="px-1.5 py-0.5 rounded bg-[#0B0F14] border border-[#232B35] text-[10px] font-mono text-[#4C8DFF]"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-[#131A22] border border-[#232B35] rounded-xl p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#232B35] pb-3 mb-4">
              <h3 className="font-mono text-sm font-semibold uppercase text-[#E4E9EE] flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#4C8DFF]" />
                Create New Platform User
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="font-mono text-xs text-[#8B96A3] hover:text-[#E4E9EE]"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-2.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 font-mono text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4 font-mono text-xs">
              <div>
                <label className="block text-[#8B96A3] mb-1">Full Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Sarah Connor"
                  className="w-full bg-[#0B0F14] border border-[#232B35] rounded-lg px-3 py-2 text-[#E4E9EE] focus:outline-none focus:border-[#4C8DFF]"
                  required
                />
              </div>

              <div>
                <label className="block text-[#8B96A3] mb-1">Work Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="sarah@reflex.local"
                  className="w-full bg-[#0B0F14] border border-[#232B35] rounded-lg px-3 py-2 text-[#E4E9EE] focus:outline-none focus:border-[#4C8DFF]"
                  required
                />
              </div>

              <div>
                <label className="block text-[#8B96A3] mb-1">Initial Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-[#0B0F14] border border-[#232B35] rounded-lg px-3 py-2 text-[#E4E9EE] focus:outline-none focus:border-[#4C8DFF]"
                  required
                />
              </div>

              <div>
                <label className="block text-[#8B96A3] mb-1">Role Assignment</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full bg-[#0B0F14] border border-[#232B35] rounded-lg px-3 py-2 text-[#E4E9EE] focus:outline-none focus:border-[#4C8DFF]"
                >
                  <option value="admin">Admin (Full Control)</option>
                  <option value="operator">Operator (Governance & Fleet Ops)</option>
                  <option value="auditor">Auditor (Read-Only Compliance)</option>
                </select>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#232B35]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded border border-[#232B35] text-[#8B96A3] hover:text-[#E4E9EE]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-1.5 rounded bg-[#4C8DFF] text-white font-semibold hover:bg-[#4C8DFF]/90 disabled:opacity-50"
                >
                  {actionLoading ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#131A22] border border-[#232B35] rounded-xl p-5 shadow-2xl">
            <h3 className="font-mono text-sm font-semibold uppercase text-[#E4E9EE] mb-3">
              Reset User Password
            </h3>
            <form onSubmit={handleResetPassword} className="space-y-4 font-mono text-xs">
              <div>
                <label className="block text-[#8B96A3] mb-1">New Password</label>
                <input
                  type="password"
                  value={resetNewPass}
                  onChange={(e) => setResetNewPass(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full bg-[#0B0F14] border border-[#232B35] rounded-lg px-3 py-2 text-[#E4E9EE]"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowResetModal(null)}
                  className="px-3 py-1 rounded border border-[#232B35] text-[#8B96A3]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-3 py-1 rounded bg-[#4C8DFF] text-white font-semibold"
                >
                  Reset Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
