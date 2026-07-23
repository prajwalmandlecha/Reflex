import type {
  AgentClass,
  AgentInstance,
  BankConnection,
  Policy,
  ActivityEvent,
  AuditLogEntry,
  StopEvent,
  AlertItem,
} from './types';

export const agentClasses: AgentClass[] = [
  {
    id: 'cls-treasury',
    name: 'Treasury Operations',
    description: 'Manages liquidity, inter-account transfers, and cash positioning.',
    allowedTools: ['wire_transfer', 'balance_check', 'fx_quote', 'sweep_account'],
    defaultConstraints: {
      maxTransferAmount: 500000,
      allowedCurrencies: ['USD', 'EUR', 'GBP'],
      businessHoursOnly: true,
    },
    defaultCap: { amount: 5000000, window: 'day' },
    instanceCount: 4,
  },
  {
    id: 'cls-payments',
    name: 'Payment Processing',
    description: 'Handles outbound payment orchestration and settlement.',
    allowedTools: ['ach_transfer', 'wire_transfer', 'sepa_transfer', 'balance_check'],
    defaultConstraints: {
      maxTransferAmount: 100000,
      allowedCurrencies: ['USD', 'EUR'],
      businessHoursOnly: false,
    },
    defaultCap: { amount: 2000000, window: 'day' },
    instanceCount: 5,
  },
  {
    id: 'cls-compliance',
    name: 'Compliance Screening',
    description: 'Performs AML/KYC checks and sanctions screening on transactions.',
    allowedTools: ['sanctions_check', 'kyc_lookup', 'risk_score', 'alert_disposition'],
    defaultConstraints: {
      autoEscalate: true,
      minRiskThreshold: 0.65,
    },
    defaultCap: { amount: 0, window: 'day' },
    instanceCount: 3,
  },
  {
    id: 'cls-trading',
    name: 'Prop Trading Desk',
    description: 'Executes market-making and arbitrage strategies on listed instruments.',
    allowedTools: ['market_order', 'limit_order', 'fx_quote', 'position_check'],
    defaultConstraints: {
      maxOrderSize: 50000,
      allowedVenues: ['NYSE', 'NASDAQ', 'CME'],
      maxOpenPositions: 20,
    },
    defaultCap: { amount: 10000000, window: 'day' },
    instanceCount: 6,
  },
  {
    id: 'cls-recon',
    name: 'Reconciliation',
    description: 'Reconciles internal books against external statements and feeds.',
    allowedTools: ['balance_check', 'statement_fetch', 'break_report'],
    defaultConstraints: {
      batchSize: 1000,
      feedTimeoutMs: 30000,
    },
    defaultCap: { amount: 0, window: 'day' },
    instanceCount: 2,
  },
];

export const agentInstances: AgentInstance[] = [
  // Treasury
  { id: 'ag-treasury-01', classId: 'cls-treasury', status: 'active', spendToday: 3450000, capToday: 5000000, lastAction: 'wire_transfer', lastSeen: new Date(Date.now() - 4000).toISOString() },
  { id: 'ag-treasury-02', classId: 'cls-treasury', status: 'active', spendToday: 4850000, capToday: 5000000, lastAction: 'fx_quote', lastSeen: new Date(Date.now() - 12000).toISOString() },
  { id: 'ag-treasury-03', classId: 'cls-treasury', status: 'active', spendToday: 1200000, capToday: 5000000, lastAction: 'sweep_account', lastSeen: new Date(Date.now() - 28000).toISOString() },
  { id: 'ag-treasury-04', classId: 'cls-treasury', status: 'revoked', spendToday: 5000000, capToday: 5000000, lastAction: 'wire_transfer (denied)', lastSeen: new Date(Date.now() - 90000).toISOString(), instanceOverrides: { capOverride: { amount: 3000000, window: 'day' } } },

  // Payments
  { id: 'ag-payments-01', classId: 'cls-payments', status: 'active', spendToday: 890000, capToday: 2000000, lastAction: 'ach_transfer', lastSeen: new Date(Date.now() - 2000).toISOString() },
  { id: 'ag-payments-02', classId: 'cls-payments', status: 'active', spendToday: 1750000, capToday: 2000000, lastAction: 'sepa_transfer', lastSeen: new Date(Date.now() - 8000).toISOString() },
  { id: 'ag-payments-03', classId: 'cls-payments', status: 'active', spendToday: 450000, capToday: 2000000, lastAction: 'wire_transfer', lastSeen: new Date(Date.now() - 15000).toISOString() },
  { id: 'ag-payments-04', classId: 'cls-payments', status: 'killed', spendToday: 2000000, capToday: 2000000, lastAction: 'ach_transfer (denied)', lastSeen: new Date(Date.now() - 300000).toISOString() },
  { id: 'ag-payments-05', classId: 'cls-payments', status: 'active', spendToday: 1100000, capToday: 2000000, lastAction: 'ach_transfer', lastSeen: new Date(Date.now() - 5000).toISOString() },

  // Compliance
  { id: 'ag-compliance-01', classId: 'cls-compliance', status: 'active', spendToday: 0, capToday: 0, lastAction: 'sanctions_check', lastSeen: new Date(Date.now() - 3000).toISOString() },
  { id: 'ag-compliance-02', classId: 'cls-compliance', status: 'active', spendToday: 0, capToday: 0, lastAction: 'kyc_lookup', lastSeen: new Date(Date.now() - 20000).toISOString() },
  { id: 'ag-compliance-03', classId: 'cls-compliance', status: 'revoked', spendToday: 0, capToday: 0, lastAction: 'alert_disposition (denied)', lastSeen: new Date(Date.now() - 600000).toISOString() },

  // Trading
  { id: 'ag-trading-01', classId: 'cls-trading', status: 'active', spendToday: 7200000, capToday: 10000000, lastAction: 'limit_order', lastSeen: new Date(Date.now() - 1000).toISOString() },
  { id: 'ag-trading-02', classId: 'cls-trading', status: 'active', spendToday: 9800000, capToday: 10000000, lastAction: 'market_order', lastSeen: new Date(Date.now() - 6000).toISOString() },
  { id: 'ag-trading-03', classId: 'cls-trading', status: 'active', spendToday: 3400000, capToday: 10000000, lastAction: 'fx_quote', lastSeen: new Date(Date.now() - 9000).toISOString() },
  { id: 'ag-trading-04', classId: 'cls-trading', status: 'active', spendToday: 5500000, capToday: 10000000, lastAction: 'limit_order', lastSeen: new Date(Date.now() - 14000).toISOString() },
  { id: 'ag-trading-05', classId: 'cls-trading', status: 'killed', spendToday: 10000000, capToday: 10000000, lastAction: 'market_order (denied)', lastSeen: new Date(Date.now() - 1200000).toISOString() },
  { id: 'ag-trading-06', classId: 'cls-trading', status: 'active', spendToday: 2100000, capToday: 10000000, lastAction: 'position_check', lastSeen: new Date(Date.now() - 7000).toISOString() },

  // Reconciliation
  { id: 'ag-recon-01', classId: 'cls-recon', status: 'active', spendToday: 0, capToday: 0, lastAction: 'statement_fetch', lastSeen: new Date(Date.now() - 45000).toISOString() },
  { id: 'ag-recon-02', classId: 'cls-recon', status: 'active', spendToday: 0, capToday: 0, lastAction: 'break_report', lastSeen: new Date(Date.now() - 60000).toISOString() },
];

export const bankConnections: BankConnection[] = [
  {
    id: 'bank-core-ledger',
    name: 'Core Banking Ledger',
    sourceType: 'native_mcp',
    toolCount: 4,
    status: 'connected',
    authType: 'bearer',
    lastSync: new Date(Date.now() - 300000).toISOString(),
    tools: [
      { id: 't1', name: 'wire_transfer', method: 'POST', path: '/v1/transfers/wire', description: 'Initiate a wire transfer between accounts.', exposed: true, convertible: true },
      { id: 't2', name: 'ach_transfer', method: 'POST', path: '/v1/transfers/ach', description: 'Initiate an ACH transfer.', exposed: true, convertible: true },
      { id: 't3', name: 'sepa_transfer', method: 'POST', path: '/v1/transfers/sepa', description: 'Initiate a SEPA transfer.', exposed: true, convertible: true },
      { id: 't4', name: 'balance_check', method: 'GET', path: '/v1/accounts/{id}/balance', description: 'Check account balance.', exposed: true, convertible: true },
    ],
  },
  {
    id: 'bank-fx-feed',
    name: 'FX Market Data Feed',
    sourceType: 'openapi',
    toolCount: 2,
    status: 'connected',
    authType: 'api_key',
    lastSync: new Date(Date.now() - 600000).toISOString(),
    tools: [
      { id: 't5', name: 'fx_quote', method: 'GET', path: '/v1/fx/quote', description: 'Get a real-time FX quote.', exposed: true, convertible: true },
      { id: 't6', name: 'fx_history', method: 'GET', path: '/v1/fx/history', description: 'Get historical FX rates.', exposed: false, convertible: true },
    ],
  },
  {
    id: 'bank-trading-venue',
    name: 'Execution Venue Gateway',
    sourceType: 'openapi',
    toolCount: 4,
    status: 'connected',
    authType: 'oauth2',
    lastSync: new Date(Date.now() - 1200000).toISOString(),
    tools: [
      { id: 't7', name: 'market_order', method: 'POST', path: '/v1/orders/market', description: 'Submit a market order.', exposed: true, convertible: true },
      { id: 't8', name: 'limit_order', method: 'POST', path: '/v1/orders/limit', description: 'Submit a limit order.', exposed: true, convertible: true },
      { id: 't9', name: 'position_check', method: 'GET', path: '/v1/positions', description: 'Check current open positions.', exposed: true, convertible: true },
      { id: 't10', name: 'cancel_order', method: 'DELETE', path: '/v1/orders/{id}', description: 'Cancel an open order.', exposed: false, convertible: true },
    ],
  },
  {
    id: 'bank-compliance-svc',
    name: 'Compliance & Screening Service',
    sourceType: 'native_mcp',
    toolCount: 4,
    status: 'connected',
    authType: 'bearer',
    lastSync: new Date(Date.now() - 1800000).toISOString(),
    tools: [
      { id: 't11', name: 'sanctions_check', method: 'POST', path: '/v1/screening/sanctions', description: 'Screen a counterparty against sanctions lists.', exposed: true, convertible: true },
      { id: 't12', name: 'kyc_lookup', method: 'GET', path: '/v1/kyc/{entityId}', description: 'Retrieve KYC profile for an entity.', exposed: true, convertible: true },
      { id: 't13', name: 'risk_score', method: 'POST', path: '/v1/risk/score', description: 'Compute a composite risk score.', exposed: true, convertible: true },
      { id: 't14', name: 'alert_disposition', method: 'POST', path: '/v1/alerts/{id}/disposition', description: 'Dispose of a compliance alert.', exposed: true, convertible: true },
    ],
  },
  {
    id: 'bank-recon-feed',
    name: 'Reconciliation Feed',
    sourceType: 'manual',
    toolCount: 3,
    status: 'error',
    authType: 'basic',
    lastSync: new Date(Date.now() - 7200000).toISOString(),
    tools: [
      { id: 't15', name: 'statement_fetch', method: 'GET', path: '/v1/statements', description: 'Fetch external statements.', exposed: true, convertible: true },
      { id: 't16', name: 'break_report', method: 'POST', path: '/v1/recon/breaks', description: 'Report a reconciliation break.', exposed: true, convertible: true },
      { id: 't17', name: 'sweep_account', method: 'POST', path: '/v1/sweeps', description: 'Sweep balances between accounts.', exposed: true, convertible: false },
    ],
  },
  {
    id: 'bank-pending-01',
    name: 'Custody Settlement API',
    sourceType: 'openapi',
    toolCount: 0,
    status: 'pending',
    tools: [],
  },
];

export const policies: Policy[] = [
  {
    id: 'pol-001',
    name: 'Treasury Wire Cap Guard',
    scope: 'class',
    targetId: 'cls-treasury',
    targetName: 'Treasury Operations',
    type: 'visual',
    status: 'active',
    lastModified: new Date(Date.now() - 86400000 * 2).toISOString(),
    visualRule: {
      action: 'wire_transfer',
      conditions: [
        { field: 'amount', operator: 'lte', value: 500000 },
        { field: 'currency', operator: 'in', value: 'USD,EUR,GBP' },
      ],
    },
  },
  {
    id: 'pol-002',
    name: 'Trading Venue Restriction',
    scope: 'class',
    targetId: 'cls-trading',
    targetName: 'Prop Trading Desk',
    type: 'rego',
    status: 'active',
    lastModified: new Date(Date.now() - 86400000 * 5).toISOString(),
    regoSource: `package trading.guard

default allow := false

allow if {
  input.action == "market_order"
  input.params.venue in {"NYSE", "NASDAQ", "CME"}
  input.params.size <= 50000
  count(input.open_positions) < 20
}

deny[msg] if {
  input.action == "market_order"
  input.params.size > 50000
  msg := "Order size exceeds 50,000 share limit"
}

deny[msg] if {
  input.action == "market_order"
  count(input.open_positions) >= 20
  msg := "Max open positions (20) reached"
}`,
  },
  {
    id: 'pol-003',
    name: 'Payments After-Hours Block',
    scope: 'class',
    targetId: 'cls-payments',
    targetName: 'Payment Processing',
    type: 'visual',
    status: 'active',
    lastModified: new Date(Date.now() - 86400000 * 1).toISOString(),
    visualRule: {
      action: 'wire_transfer',
      conditions: [
        { field: 'amount', operator: 'lte', value: 100000 },
        { field: 'timestamp', operator: 'contains', value: 'business_hours' },
      ],
    },
  },
  {
    id: 'pol-004',
    name: 'Compliance Auto-Escalation',
    scope: 'class',
    targetId: 'cls-compliance',
    targetName: 'Compliance Screening',
    type: 'rego',
    status: 'active',
    lastModified: new Date(Date.now() - 86400000 * 7).toISOString(),
    regoSource: `package compliance.guard

default allow := true

deny[msg] if {
  input.action == "alert_disposition"
  input.params.risk_score > 0.65
  input.params.disposition == "clear"
  msg := "Cannot auto-clear alerts with risk score > 0.65"
}`,
  },
  {
    id: 'pol-005',
    name: 'Treasury-04 Restricted Tools',
    scope: 'instance',
    targetId: 'ag-treasury-04',
    targetName: 'ag-treasury-04',
    type: 'visual',
    status: 'draft',
    lastModified: new Date(Date.now() - 3600000 * 3).toISOString(),
    visualRule: {
      action: 'wire_transfer',
      conditions: [
        { field: 'amount', operator: 'lte', value: 250000 },
      ],
    },
  },
  {
    id: 'pol-006',
    name: 'Trading-02 Position Limit Override',
    scope: 'instance',
    targetId: 'ag-trading-02',
    targetName: 'ag-trading-02',
    type: 'rego',
    status: 'draft',
    lastModified: new Date(Date.now() - 3600000 * 8).toISOString(),
    regoSource: `package trading.ag02

default allow := false

allow if {
  input.action == "market_order"
  input.params.size <= 25000
  count(input.open_positions) < 15
}`,
  },
];

const actionPool = [
  { action: 'wire_transfer', params: { amount: 250000, currency: 'USD', counterparty: 'ACME Corp' } },
  { action: 'ach_transfer', params: { amount: 45000, currency: 'USD', counterparty: 'Globex LLC' } },
  { action: 'sepa_transfer', params: { amount: 78000, currency: 'EUR', counterparty: 'Initech SARL' } },
  { action: 'fx_quote', params: { pair: 'EUR/USD', notional: 500000 } },
  { action: 'sweep_account', params: { from: 'acct-001', to: 'acct-002', amount: 1200000 } },
  { action: 'balance_check', params: { account: 'acct-001' } },
  { action: 'sanctions_check', params: { entity: 'ACME Corp', list: 'OFAC' } },
  { action: 'kyc_lookup', params: { entityId: 'ent-9843' } },
  { action: 'risk_score', params: { entity: 'Globex LLC', factors: ['geo', 'industry'] } },
  { action: 'alert_disposition', params: { alertId: 'alert-3321', risk_score: 0.72, disposition: 'escalate' } },
  { action: 'market_order', params: { venue: 'NYSE', symbol: 'AAPL', side: 'buy', size: 10000 } },
  { action: 'limit_order', params: { venue: 'NASDAQ', symbol: 'MSFT', side: 'sell', size: 5000, price: 420.5 } },
  { action: 'position_check', params: { book: 'prop-desk-1' } },
  { action: 'statement_fetch', params: { source: 'bofa', date: '2026-07-21' } },
  { action: 'break_report', params: { breakId: 'brk-552', severity: 'low' } },
];

const denyReasons = [
  'Denied — spend cap exceeded (instance): $5,000,000 / $5,000,000 daily',
  'Denied — spend cap exceeded (instance): $2,000,000 / $2,000,000 daily',
  'Denied — order size exceeds 50,000 share limit (policy: trading.guard)',
  'Denied — max open positions (20) reached (policy: trading.guard)',
  'Denied — cannot auto-clear alerts with risk score > 0.65 (policy: compliance.guard)',
  'Denied — transfer amount exceeds class max: $500,000 (policy: treasury-wire-cap)',
  'Denied — currency not in allowed set [USD, EUR, GBP] (policy: treasury-wire-cap)',
  'Denied — wire transfers restricted to business hours (policy: payments-after-hours)',
];

const classMap: Record<string, string> = {
  'cls-treasury': 'Treasury Operations',
  'cls-payments': 'Payment Processing',
  'cls-compliance': 'Compliance Screening',
  'cls-trading': 'Prop Trading Desk',
  'cls-recon': 'Reconciliation',
};

let eventCounter = 1000;

export function generateActivityEvent(): ActivityEvent {
  const instance = agentInstances[Math.floor(Math.random() * agentInstances.length)];
  const pool = actionPool[Math.floor(Math.random() * actionPool.length)];
  const isDeny = Math.random() < 0.18;
  const classId = instance.classId;
  const bankConn = bankConnections[Math.floor(Math.random() * bankConnections.length)];

  return {
    id: `evt-${eventCounter++}`,
    timestamp: new Date().toISOString(),
    agentId: instance.id,
    agentClass: classMap[classId] || classId,
    action: pool.action,
    params: pool.params,
    decision: isDeny ? 'deny' : 'allow',
    reason: isDeny ? denyReasons[Math.floor(Math.random() * denyReasons.length)] : undefined,
    latencyMs: Math.floor(Math.random() * 180) + 8,
    bankConnectionId: bankConn.id,
  };
}

export function seedActivityFeed(count: number): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (let i = 0; i < count; i++) {
    const evt = generateActivityEvent();
    evt.timestamp = new Date(Date.now() - i * (Math.random() * 4000 + 1000)).toISOString();
    events.push(evt);
  }
  return events;
}

export const auditLog: AuditLogEntry[] = [
  {
    id: 'aud-001',
    entryType: 'stop_event',
    timestamp: new Date(Date.now() - 1200000).toISOString(),
    agentId: 'ag-trading-05',
    agentClass: 'Prop Trading Desk',
    action: 'emergency_stop',
    params: {},
    decision: 'allow',
    latencyMs: 0,
    operator: 'm.chen',
    reason: 'Manual emergency stop — anomalous order pattern detected',
    oldValue: 'active',
    newValue: 'killed',
  },
  {
    id: 'aud-002',
    entryType: 'stop_event',
    timestamp: new Date(Date.now() - 300000).toISOString(),
    agentId: 'ag-payments-04',
    agentClass: 'Payment Processing',
    action: 'emergency_stop',
    params: {},
    decision: 'allow',
    latencyMs: 0,
    operator: 'j.patel',
    reason: 'Manual emergency stop — repeated cap breaches',
    oldValue: 'active',
    newValue: 'killed',
  },
  {
    id: 'aud-003',
    entryType: 'policy_change',
    timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
    agentId: '-',
    agentClass: '-',
    action: 'policy_update',
    params: {},
    decision: 'allow',
    latencyMs: 0,
    operator: 'm.chen',
    reason: 'Policy "Treasury Wire Cap Guard" activated',
    oldValue: 'draft',
    newValue: 'active',
  },
  {
    id: 'aud-004',
    entryType: 'config_change',
    timestamp: new Date(Date.now() - 86400000 * 3).toISOString(),
    agentId: 'ag-treasury-04',
    agentClass: 'Treasury Operations',
    action: 'cap_override_change',
    params: {},
    decision: 'allow',
    latencyMs: 0,
    operator: 'j.patel',
    reason: 'Instance cap override lowered',
    oldValue: '$5,000,000 daily',
    newValue: '$3,000,000 daily',
  },
  {
    id: 'aud-005',
    entryType: 'config_change',
    timestamp: new Date(Date.now() - 86400000 * 1).toISOString(),
    agentId: '-',
    agentClass: '-',
    action: 'bank_connection_added',
    params: {},
    decision: 'allow',
    latencyMs: 0,
    operator: 'm.chen',
    reason: 'Bank connection "Execution Venue Gateway" registered',
    oldValue: '—',
    newValue: 'connected',
  },
  {
    id: 'aud-006',
    entryType: 'action',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
    agentId: 'ag-treasury-02',
    agentClass: 'Treasury Operations',
    action: 'wire_transfer',
    params: { amount: 500000, currency: 'USD' },
    decision: 'deny',
    latencyMs: 42,
    bankConnectionId: 'bank-core-ledger',
    reason: 'Denied — spend cap exceeded (instance): $4,850,000 / $5,000,000 daily',
  },
  {
    id: 'aud-007',
    entryType: 'action',
    timestamp: new Date(Date.now() - 3600000 * 3).toISOString(),
    agentId: 'ag-trading-02',
    agentClass: 'Prop Trading Desk',
    action: 'market_order',
    params: { venue: 'NYSE', symbol: 'AAPL', size: 60000 },
    decision: 'deny',
    latencyMs: 38,
    bankConnectionId: 'bank-trading-venue',
    reason: 'Denied — order size exceeds 50,000 share limit (policy: trading.guard)',
  },
  {
    id: 'aud-008',
    entryType: 'action',
    timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
    agentId: 'ag-compliance-03',
    agentClass: 'Compliance Screening',
    action: 'alert_disposition',
    params: { risk_score: 0.78, disposition: 'clear' },
    decision: 'deny',
    latencyMs: 51,
    bankConnectionId: 'bank-compliance-svc',
    reason: 'Denied — cannot auto-clear alerts with risk score > 0.65 (policy: compliance.guard)',
  },
  ...seedActivityFeed(40).map((e, i) => ({
    ...e,
    id: `aud-${100 + i}`,
    entryType: 'action' as const,
  })),
];

export const stopEvents: StopEvent[] = [
  {
    id: 'stop-001',
    timestamp: new Date(Date.now() - 1200000).toISOString(),
    scope: 'instance',
    targetId: 'ag-trading-05',
    targetName: 'ag-trading-05',
    action: 'stop',
    operator: 'm.chen',
    reason: 'Anomalous order pattern detected',
  },
  {
    id: 'stop-002',
    timestamp: new Date(Date.now() - 300000).toISOString(),
    scope: 'instance',
    targetId: 'ag-payments-04',
    targetName: 'ag-payments-04',
    action: 'stop',
    operator: 'j.patel',
    reason: 'Repeated cap breaches',
  },
  {
    id: 'stop-003',
    timestamp: new Date(Date.now() - 86400000 * 14).toISOString(),
    scope: 'fleet',
    action: 'stop',
    operator: 'system',
    reason: 'Scheduled maintenance window',
  },
  {
    id: 'stop-004',
    timestamp: new Date(Date.now() - 86400000 * 14 + 3600000).toISOString(),
    scope: 'fleet',
    action: 'resume',
    operator: 'system',
    reason: 'Maintenance complete',
  },
  {
    id: 'stop-005',
    timestamp: new Date(Date.now() - 86400000 * 30).toISOString(),
    scope: 'class',
    targetId: 'cls-trading',
    targetName: 'Prop Trading Desk',
    action: 'stop',
    operator: 'm.chen',
    reason: 'Market volatility circuit breaker',
  },
];

export const alerts: AlertItem[] = [
  {
    id: 'alert-001',
    timestamp: new Date(Date.now() - 300000).toISOString(),
    severity: 'critical',
    category: 'emergency_stop',
    title: 'Agent ag-payments-04 emergency stopped',
    detail: 'Operator j.patel triggered emergency stop — repeated cap breaches',
    source: 'Emergency Stop Control',
  },
  {
    id: 'alert-002',
    timestamp: new Date(Date.now() - 1200000).toISOString(),
    severity: 'critical',
    category: 'emergency_stop',
    title: 'Agent ag-trading-05 emergency stopped',
    detail: 'Operator m.chen triggered emergency stop — anomalous order pattern',
    source: 'Emergency Stop Control',
  },
  {
    id: 'alert-003',
    timestamp: new Date(Date.now() - 600000).toISOString(),
    severity: 'warning',
    category: 'cap_breach',
    title: 'ag-treasury-02 at 97% of daily cap',
    detail: 'Spend $4,850,000 / $5,000,000 daily — approaching hard limit',
    source: 'Spend Monitor',
  },
  {
    id: 'alert-004',
    timestamp: new Date(Date.now() - 900000).toISOString(),
    severity: 'warning',
    category: 'cap_breach',
    title: 'ag-trading-02 at 98% of daily cap',
    detail: 'Spend $9,800,000 / $10,000,000 daily — approaching hard limit',
    source: 'Spend Monitor',
  },
  {
    id: 'alert-005',
    timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
    severity: 'info',
    category: 'policy_change',
    title: 'Policy "Treasury Wire Cap Guard" activated',
    detail: 'Operator m.chen activated a visual policy for Treasury Operations',
    source: 'Policy Manager',
  },
  {
    id: 'alert-006',
    timestamp: new Date(Date.now() - 86400000 * 3).toISOString(),
    severity: 'warning',
    category: 'revocation',
    title: 'ag-treasury-04 instance revoked',
    detail: 'Instance revoked after cap override breach — spend capped at $3M',
    source: 'Agent Manager',
  },
];

export const operatorName = 'm.chen';
