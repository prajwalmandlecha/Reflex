// ── Agents ───────────────────────────────────────────────────────────────────
export const MOCK_AGENTS = [
  {
    id: 'AGT-001', name: 'FraudGuard-Alpha',
    class: 'fraud-detection', status: 'active',
    spend: 421.50, cap: 500, capPercent: 84,
    actions: 1240, denies: 3, lastSeen: '2s ago',
    riskScore: 0.12,
    permissions: ['read:transactions', 'flag:suspicious', 'notify:compliance'],
    model: 'GPT-4o',
  },
  {
    id: 'AGT-002', name: 'ComplianceBot-7',
    class: 'compliance', status: 'active',
    spend: 189.00, cap: 300, capPercent: 63,
    actions: 580, denies: 1, lastSeen: '12s ago',
    riskScore: 0.05,
    permissions: ['read:accounts', 'read:transactions', 'write:reports'],
    model: 'Claude 3.5 Sonnet',
  },
  {
    id: 'AGT-003', name: 'LoanProcessor-Beta',
    class: 'loan-processing', status: 'active',
    spend: 290.20, cap: 300, capPercent: 97,
    actions: 340, denies: 12, lastSeen: '1m ago',
    riskScore: 0.71,
    permissions: ['read:credit-scores', 'submit:loan-applications'],
    model: 'GPT-4o',
  },
  {
    id: 'AGT-004', name: 'ReportGen-Delta',
    class: 'reporting', status: 'revoked',
    spend: 300.00, cap: 300, capPercent: 100,
    actions: 120, denies: 0, lastSeen: '4h ago',
    riskScore: 0.9,
    permissions: [],
    model: 'GPT-4o-mini',
  },
  {
    id: 'AGT-005', name: 'CustomerCare-Zeta',
    class: 'customer-service', status: 'idle',
    spend: 45.00, cap: 200, capPercent: 22,
    actions: 89, denies: 0, lastSeen: '5m ago',
    riskScore: 0.03,
    permissions: ['read:accounts', 'send:emails'],
    model: 'Claude 3 Haiku',
  },
];

// ── Agent Classes ──────────────────────────────────────────────────────────────
export const MOCK_CLASSES = [
  {
    id: 'fraud-detection', name: 'Fraud Detection',
    agents: 1, defaultCap: 500,
    allowedTools: ['read:transactions', 'flag:suspicious', 'notify:compliance'],
    description: 'Monitors transactions in real-time for anomalies and fraud patterns.',
  },
  {
    id: 'compliance', name: 'Compliance',
    agents: 1, defaultCap: 300,
    allowedTools: ['read:accounts', 'read:transactions', 'write:reports'],
    description: 'Ensures regulatory compliance and generates compliance reports.',
  },
  {
    id: 'loan-processing', name: 'Loan Processing',
    agents: 1, defaultCap: 300,
    allowedTools: ['read:credit-scores', 'submit:loan-applications'],
    description: 'Processes loan applications and evaluates creditworthiness.',
  },
  {
    id: 'reporting', name: 'Reporting',
    agents: 1, defaultCap: 300,
    allowedTools: ['read:accounts', 'read:transactions', 'write:reports'],
    description: 'Generates financial reports and summaries.',
  },
  {
    id: 'customer-service', name: 'Customer Service',
    agents: 1, defaultCap: 200,
    allowedTools: ['read:accounts', 'send:emails'],
    description: 'Handles customer inquiries and support requests.',
  },
];

// ── Policies ──────────────────────────────────────────────────────────────────
export const MOCK_POLICIES = [
  {
    id: 'POL-001', name: 'No External API Calls',
    status: 'enforced', priority: 'critical',
    rule: 'deny if action.tool not in allowed_tools',
    affects: 'all agents',
    created: '2024-01-10', violations: 15,
  },
  {
    id: 'POL-002', name: 'Daily Spend Cap Enforcement',
    status: 'enforced', priority: 'high',
    rule: 'deny if agent.spend_today >= agent.cap',
    affects: 'all agents',
    created: '2024-01-10', violations: 4,
  },
  {
    id: 'POL-003', name: 'PII Data Masking',
    status: 'enforced', priority: 'critical',
    rule: 'mask PII fields in all LLM inputs/outputs',
    affects: 'all agents',
    created: '2024-01-12', violations: 0,
  },
  {
    id: 'POL-004', name: 'High-Value Transaction Approval',
    status: 'enforced', priority: 'high',
    rule: 'require human approval for transactions > $10,000',
    affects: 'fraud-detection, loan-processing',
    created: '2024-01-15', violations: 2,
  },
  {
    id: 'POL-005', name: 'Audit Log Retention',
    status: 'enforced', priority: 'medium',
    rule: 'retain all action logs for 7 years',
    affects: 'system-wide',
    created: '2024-01-10', violations: 0,
  },
];

// ── Bank Connections ──────────────────────────────────────────────────────────
export const MOCK_CONNECTIONS = [
  {
    id: 'CONN-001', name: 'Core Banking System',
    type: 'REST/TLS', status: 'connected', latency: 12,
    endpoint: 'https://core.bank.internal/api/v2',
    authMethod: 'mTLS + API Key',
    allowedAgents: ['fraud-detection', 'compliance', 'reporting'],
    lastHealthCheck: '1m ago',
  },
  {
    id: 'CONN-002', name: 'Credit Bureau API',
    type: 'REST/TLS', status: 'connected', latency: 245,
    endpoint: 'https://api.creditbureau.com/v1',
    authMethod: 'OAuth 2.0',
    allowedAgents: ['loan-processing'],
    lastHealthCheck: '30s ago',
  },
  {
    id: 'CONN-003', name: 'Customer CRM',
    type: 'REST/TLS', status: 'connected', latency: 38,
    endpoint: 'https://crm.bank.internal/api',
    authMethod: 'API Key',
    allowedAgents: ['customer-service', 'compliance'],
    lastHealthCheck: '2m ago',
  },
  {
    id: 'CONN-004', name: 'Notification Service',
    type: 'Message Queue', status: 'degraded', latency: 1200,
    endpoint: 'amqp://mq.bank.internal:5672',
    authMethod: 'AMQP Auth',
    allowedAgents: ['fraud-detection'],
    lastHealthCheck: '5m ago',
  },
];

// ── Audit Log ─────────────────────────────────────────────────────────────────
export const MOCK_AUDIT_LOGS = [
  { id: 'AUD-9881', ts: '14:23:01', agent: 'FraudGuard-Alpha', action: 'tool_call', tool: 'flag:suspicious', result: 'allow', hash: '0x7f2a9b1', risk: 0.12 },
  { id: 'AUD-9880', ts: '14:22:55', agent: 'ComplianceBot-7', action: 'tool_call', tool: 'read:transactions', result: 'allow', hash: '0x4d1e2c8', risk: 0.05 },
  { id: 'AUD-9879', ts: '14:22:48', agent: 'LoanProcessor-Beta', action: 'tool_call', tool: 'exec:shell', result: 'deny', hash: '0x9a3f4e2', risk: 0.98 },
  { id: 'AUD-9878', ts: '14:22:30', agent: 'ReportGen-Delta', action: 'spend_limit', tool: 'write:reports', result: 'deny', hash: '0x2b8c1f4', risk: 0.9 },
  { id: 'AUD-9877', ts: '14:21:12', agent: 'CustomerCare-Zeta', action: 'tool_call', tool: 'send:emails', result: 'allow', hash: '0x5e7d3a9', risk: 0.03 },
  { id: 'AUD-9876', ts: '14:20:05', agent: 'FraudGuard-Alpha', action: 'tool_call', tool: 'notify:compliance', result: 'allow', hash: '0x8f1c6b2', risk: 0.15 },
  { id: 'AUD-9875', ts: '14:19:44', agent: 'LoanProcessor-Beta', action: 'tool_call', tool: 'read:credit-scores', result: 'allow', hash: '0x3d9e5c7', risk: 0.45 },
  { id: 'AUD-9874', ts: '14:18:30', agent: 'ComplianceBot-7', action: 'tool_call', tool: 'write:reports', result: 'allow', hash: '0x6a2f8d1', risk: 0.05 },
];

// ── Activity Stream ───────────────────────────────────────────────────────────
export const MOCK_ACTIVITY = [
  { id: 1, ts: '14:23:01', agent: 'FraudGuard-Alpha', event: 'Flagged suspicious transaction TXN-88219 for review', type: 'allow' },
  { id: 2, ts: '14:22:48', agent: 'LoanProcessor-Beta', event: 'Attempted exec:shell — BLOCKED by OPA policy', type: 'deny' },
  { id: 3, ts: '14:22:30', agent: 'ReportGen-Delta', event: 'Spend cap $300/$300 reached — access REVOKED', type: 'revoke' },
  { id: 4, ts: '14:21:12', agent: 'CustomerCare-Zeta', event: 'Sent account summary email to customer C-4412', type: 'allow' },
  { id: 5, ts: '14:19:44', agent: 'ComplianceBot-7', event: 'Compliance report generated: REG-Q3-2024', type: 'allow' },
];

// ── Spend by Class ────────────────────────────────────────────────────────────
export const MOCK_SPEND_BY_CLASS = [
  { class: 'Fraud Detection', spend: 421.50, cap: 500, color: '#4c8dff' },
  { class: 'Compliance',      spend: 189.00, cap: 300, color: '#3ddc84' },
  { class: 'Loan Processing', spend: 290.20, cap: 300, color: '#e3b341' },
  { class: 'Reporting',       spend: 300.00, cap: 300, color: '#f85149' },
  { class: 'Customer Service',spend: 45.00,  cap: 200, color: '#a78bfa' },
];

// ── Fleet metrics ─────────────────────────────────────────────────────────────
export const FLEET_METRICS = {
  totalAgents: 5,
  activeAgents: 3,
  idleAgents: 1,
  revokedAgents: 1,
  killedAgents: 0,
  totalSpend: 1245.70,
  totalCap: 1600,
  denials: 16,
  fleetStatus: 'caution',
};

// ── Throughput chart data ─────────────────────────────────────────────────────
export function generateThroughputData() {
  const data = [];
  const now = Date.now();
  for (let i = 29; i >= 0; i--) {
    data.push({
      t: new Date(now - i * 10000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      allow: Math.floor(Math.random() * 80 + 20),
      deny: Math.floor(Math.random() * 10),
    });
  }
  return data;
}

// ── Spend trajectory ──────────────────────────────────────────────────────────
export function generateSpendData() {
  const data = [];
  let spend = 0;
  const now = Date.now();
  for (let i = 23; i >= 0; i--) {
    spend += Math.random() * 60;
    data.push({
      t: `${23 - i}:00`,
      spend: parseFloat(spend.toFixed(2)),
    });
  }
  return data;
}
