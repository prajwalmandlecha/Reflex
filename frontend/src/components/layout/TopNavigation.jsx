import React from 'react';
import { Link } from 'react-router-dom';

export default function TopNavigation() {
  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        left: '288px', /* 72 * 4 = 288px (w-72) */
        zIndex: 50,
        backgroundColor: 'rgba(29,31,39,0.8)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(67,70,85,0.3)',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }}
    >
      {/* Left side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: '#0c0e16',
          border: '1px solid rgba(67,70,85,0.2)',
          borderRadius: '9999px',
          padding: '6px 16px',
          width: '320px',
          gap: '8px',
        }}>
          <span className="material-symbols-outlined" style={{ color: '#8d90a0', fontSize: '18px' }}>search</span>
          <input
            type="text"
            placeholder="Search agents, policies, or logs..."
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#e1e2ed',
              fontSize: '13px',
              width: '100%',
            }}
          />
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <Link to="/" style={{ color: '#b4c5ff', fontSize: '14px', fontFamily: 'Geist, sans-serif', fontWeight: 600, borderBottom: '2px solid #b4c5ff', paddingBottom: '2px' }}>
            Dashboard
          </Link>
          <Link to="/governance" style={{ color: '#c3c6d7', fontSize: '14px', fontFamily: 'Geist, sans-serif', fontWeight: 500, textDecoration: 'none' }} className="hover:text-white transition-colors">
            Governance
          </Link>
          <Link to="/ai-firewall-security-center" style={{ color: '#c3c6d7', fontSize: '14px', fontFamily: 'Geist, sans-serif', fontWeight: 500, textDecoration: 'none' }} className="hover:text-white transition-colors">
            Firewall
          </Link>
        </nav>
      </div>

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            style={{ padding: '8px', borderRadius: '9999px', color: '#c3c6d7', background: 'transparent', border: 'none', cursor: 'pointer' }}
            className="hover:bg-white/5 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>notifications</span>
          </button>
          <button
            style={{ padding: '8px', borderRadius: '9999px', color: '#c3c6d7', background: 'transparent', border: 'none', cursor: 'pointer' }}
            className="hover:bg-white/5 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>emergency_home</span>
          </button>
        </div>

        <div style={{ width: '1px', height: '32px', backgroundColor: 'rgba(67,70,85,0.3)' }} />

        <button style={{
          backgroundColor: '#93000a',
          color: '#ffdad6',
          padding: '6px 14px',
          borderRadius: '8px',
          fontSize: '12px',
          fontFamily: 'Geist, sans-serif',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          border: '1px solid rgba(255,180,171,0.3)',
          cursor: 'pointer',
          animation: 'pulse 2s ease-in-out infinite',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>emergency_share</span>
          EMERGENCY FLEET STOP
        </button>

        <button style={{
          backgroundColor: '#2563eb',
          color: '#eeefff',
          padding: '6px 16px',
          borderRadius: '8px',
          fontSize: '14px',
          fontFamily: 'Geist, sans-serif',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          border: 'none',
          cursor: 'pointer',
        }}
        className="hover:opacity-90 transition-opacity">
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>bolt</span>
          AI Copilot
        </button>

        <div style={{
          width: '32px', height: '32px', borderRadius: '9999px',
          backgroundColor: '#32343d',
          border: '1px solid rgba(67,70,85,0.3)',
          overflow: 'hidden',
          cursor: 'pointer',
        }}>
          <img
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuCgnlMWq-7Vvxamd1ppYYYIiUh_tKcl2ERP1seyPfX8j6Qko1K4F8p4WGE0ABMOgvrsN5-tAYSaqEZsSYmVchYZ42sPMtKY5ssTQk0s3zbCTD-h3W7GQt0M3_n_dkitNe8KZ5RKXqSgLFpBdRyMs6Yidurq1ZWzLntWfhmVW6q-NH34BTfeF8-cenbvAfdcgVc0W39-_2LhCJegjgugR_nTrPqWEJZQML9pdhLxSymX2noMom5Zb88CV"
            alt="User"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      </div>
    </header>
  );
}
