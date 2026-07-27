# Reflex Control Center UI

[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://react.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-38bdf8.svg)](https://tailwindcss.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://typescriptlang.org)

The **Reflex Control Center** is an enterprise-grade operator console built with Next.js 14, React 18, and Tailwind CSS. It provides financial security teams and platform operators with real-time observability, dynamic policy configuration, sub-millisecond emergency controls, and cryptographic audit verification.

---

## 🏛️ System Features & Dashboard Views

```
┌────────────────────────────────────────────────────────────────────────┐
│                      REFLEX OPERATOR DASHBOARD                         │
├───────────────┬────────────────────────────────────────────────────────┤
│ Navigation    │ Main Content Panels                                    │
│               │                                                        │
│ 📊 Command    │  • Command Center: Live status cards & activity feed   │
│ 🤖 Classes    │  • Agent Classes: Tool whitelists & spend cap limits   │
│ ⚡ Instances  │  • Fleet Instances: Active bots & instance status      │
│ 📜 Policies   │  • Dynamic Policies: Visual rule builder & OPA engine  │
│ 🔒 Audit Log  │  • Audit Ledger: Tamper-evident SHA-256 verifier       │
│ 🏦 Connections│  • Bank Connections: Target server & OpenAPI manager   │
│ 🚨 Fleet Halt │  • Emergency Stop: Sub-ms panic button & killswitches  │
│ 📈 Metrics    │  • Performance: P50/P95/P99 latency & throughput stats │
└───────────────┴────────────────────────────────────────────────────────┘
```

---

## 📂 Component Directory Layout

```
frontend/
├── app/
│   ├── layout.tsx              <-- Root layout with dark mode background & providers
│   ├── page.tsx                <-- Main dashboard SPA host component
│   └── globals.css             <-- Tailwind design system tokens & custom scrollbars
│
├── components/
│   ├── views/                  <-- Main operator dashboard views:
│   │   ├── command-center.tsx  <-- Overview stats, active fleet cards, live event feed
│   │   ├── agent-classes.tsx   <-- Agent Profile definitions, whitelists, spend caps
│   │   ├── agents.tsx          <-- Deployed agent bot instances & revocation status
│   │   ├── policies.tsx        <-- Visual policy condition builder & OPA code preview
│   │   ├── audit-log.tsx       <-- Cryptographic SHA-256 audit ledger & verifier
│   │   ├── bank-connections.tsx<-- Downstream MCP server endpoints & OpenAPI import
│   │   ├── emergency-stop.tsx  <-- Fleet-wide emergency stop panic button panel
│   │   ├── performance.tsx    <-- Real-time latency percentiles & decision distribution
│   │   ├── activity.tsx       <-- Real-time WebSocket event stream log viewer
│   │   └── settings.tsx       <-- Gateway settings & configuration options
│   │
│   ├── gov/                    <-- Shared governance widgets & status badges
│   └── ui/                     <-- Reusable UI components (buttons, dialogs, cards)
│
├── lib/                        <-- API client utilities, WebSocket manager, type definitions
├── public/                     <-- Static assets & icons
├── package.json                <-- Project scripts & dependency declarations
└── tailwind.config.ts          <-- Dark mode color palette & design tokens
```

---

## 🛠️ Local Setup & Running

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Start Development Server
```bash
npm run dev
```

The UI will be accessible at `http://localhost:3000`.

---

## ⚡ WebSocket Telemetry Integration

The Control Center automatically establishes a persistent WebSocket connection to the backend telemetry stream (`ws://localhost:8000/ws/telemetry`). 

Incoming events automatically update:
1. **Live Activity Stream**: Real-time ticker of tool calls, approvals, OPA blocks, and spend violations.
2. **Decision Counters**: Instant increment of allowed vs blocked decisions.
3. **Emergency Alert Banners**: Immediate visual highlighting if the fleet halt panic button is triggered.
