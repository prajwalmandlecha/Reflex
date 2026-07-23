import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

const navLinks = [
  { name: 'Dashboard',        path: '/',                          icon: 'dashboard' },
  { name: 'Agent Management', path: '/agent-management',          icon: 'smart_toy' },
  { name: 'Governance Center',path: '/governance',                icon: 'gavel' },
  { name: 'AI Firewall',      path: '/ai-firewall-security-center',icon: 'security' },
  { name: 'Multi-Agent Graph',path: '/mcp-agent-gateway-network', icon: 'account_tree' },
  { name: 'Action Logs',      path: '/audit-logs',                icon: 'history_edu' },
  { name: 'Monitoring',       path: '/monitoring',                icon: 'monitoring' },
];

export default function SideNavigation() {
  const { pathname } = useLocation();

  return (
    <aside
      style={{ backgroundColor: '#11131b', borderRight: '1px solid rgba(67,70,85,0.2)' }}
      className="fixed left-0 top-0 h-screen w-72 z-40 flex flex-col py-6 px-4 gap-2"
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-2 mb-8">
        <div
          style={{ backgroundColor: '#2563eb', boxShadow: '0 0 20px rgba(37,99,235,0.3)' }}
          className="w-10 h-10 rounded-lg flex items-center justify-center"
        >
          <span
            className="material-symbols-outlined text-white"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            security
          </span>
        </div>
        <div>
          <h2 style={{ color: '#b4c5ff', fontSize: '14px', fontWeight: 700, letterSpacing: '-0.01em', fontFamily: 'Geist, sans-serif' }}>
            Guardian AI
          </h2>
          <p style={{ color: '#8d90a0', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '2px' }}>
            Enterprise Governance
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto custom-scrollbar">
        {navLinks.map((link) => {
          const isActive = pathname === link.path;
          return (
            <Link
              key={link.name}
              to={link.path}
              style={isActive ? {
                backgroundColor: '#2563eb',
                color: '#eeefff',
              } : {
                color: '#c3c6d7',
              }}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors duration-150',
                !isActive && 'hover:bg-[#282a32]'
              )}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '22px', fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
              >
                {link.icon}
              </span>
              <span style={{ fontSize: '14px', fontWeight: isActive ? 600 : 500, fontFamily: 'Geist, sans-serif', letterSpacing: '0.02em' }}>
                {link.name}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div style={{ borderTop: '1px solid rgba(67,70,85,0.2)', paddingTop: '16px' }} className="mt-auto space-y-1">
        <button
          style={{ backgroundColor: '#93000a', color: '#ffdad6' }}
          className="w-full font-bold py-3 rounded-lg flex items-center justify-center gap-2 active:scale-95 transition-transform mb-4"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>emergency</span>
          <span style={{ fontSize: '14px', fontFamily: 'Geist, sans-serif', fontWeight: 600 }}>Emergency Stop</span>
        </button>
        {[
          { icon: 'help', label: 'Support', path: '/support' },
          { icon: 'settings', label: 'Settings', path: '/settings' },
        ].map((item) => (
          <Link
            key={item.label}
            to={item.path}
            style={{ color: '#c3c6d7' }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#282a32] transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{item.icon}</span>
            <span style={{ fontSize: '14px', fontFamily: 'Geist, sans-serif', fontWeight: 500 }}>{item.label}</span>
          </Link>
        ))}
      </div>
    </aside>
  );
}
