import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/layout/Layout';

const CommandCenter  = lazy(() => import('./pages/CommandCenter'));
const Agents         = lazy(() => import('./pages/Agents'));
const McpGateway     = lazy(() => import('./pages/McpGateway'));
const AiFirewall     = lazy(() => import('./pages/AiFirewall'));
const AgentClasses   = lazy(() => import('./pages/AgentClasses'));
const Policies       = lazy(() => import('./pages/Policies'));
const BankConnections= lazy(() => import('./pages/BankConnections'));
const Activity       = lazy(() => import('./pages/Activity'));
const AuditLog       = lazy(() => import('./pages/AuditLog'));
const EmergencyStop  = lazy(() => import('./pages/EmergencyStop'));
const Settings       = lazy(() => import('./pages/SettingsPage'));

const queryClient = new QueryClient();

const Loading = () => (
  <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100%',fontFamily:'JetBrains Mono, monospace',fontSize:'12px',color:'#7ab3ff',textTransform:'uppercase',letterSpacing:'0.15em' }}>
    <div style={{ animation: 'pulse-dot 1s infinite' }}>Initializing...</div>
  </div>
);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/"                 element={<CommandCenter />} />
              <Route path="/agents"           element={<Agents />} />
              <Route path="/mcp-gateway"      element={<McpGateway />} />
              <Route path="/ai-firewall"      element={<AiFirewall />} />
              <Route path="/agent-classes"    element={<AgentClasses />} />
              <Route path="/policies"         element={<Policies />} />
              <Route path="/bank-connections" element={<BankConnections />} />
              <Route path="/activity"         element={<Activity />} />
              <Route path="/audit-log"        element={<AuditLog />} />
              <Route path="/emergency-stop"   element={<EmergencyStop />} />
              <Route path="/settings"         element={<Settings />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
