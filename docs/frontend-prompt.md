# Frontend Build Prompt — Agent Governance Control Center

Use this document as the prompt/spec for a build agent (e.g. Claude Code, v0, Bolt, Lovable). It describes a complete frontend for a bank's "Governance Layer for Financial Agents" — an operator dashboard for controlling and monitoring fleets of autonomous financial agents.

---

## 1. What this is

A control-room web application for bank operators/compliance staff who supervise fleets of autonomous AI agents acting on financial systems. The app must let an operator: configure what agents/agent-classes are allowed to do, set and watch real-time spend caps, onboard bank systems, author policies (visual builder + raw Rego code), watch a live feed of every action agents attempt, search a full audit log, and — critically — hit an instant kill switch for one agent or the entire fleet.

This is a **serious, high-consequence operational tool**, not a marketing site or a consumer app. Design and copy should read like an instrument panel a professional trusts under pressure — precise, legible, calm under load, never cute.

## 2. Tech stack

- React + TypeScript
- Tailwind CSS (utility classes only, no external compiler dependency)
- shadcn/ui for base primitives (buttons, dialogs, tables, tabs) — mention if used
- recharts for charts/sparklines
- lucide-react for icons
- Build against **mocked data and a typed API client layer** (see §6) so real backend endpoints can be swapped in later without touching components. Use in-memory state + simulated interval-based updates to fake real-time activity; no localStorage/sessionStorage (not supported in this environment — use React state).
- Responsive down to a reasonably narrow desktop/tablet width; this is a professional desktop tool first, but should not break badly on a laptop screen.

## 3. Design direction (do not default to generic AI-dashboard styling)

Ground the visual language in the subject: this is a **command center for a fleet of autonomous financial agents** — closer in spirit to an air-traffic-control display or a trading floor risk desk than a SaaS admin panel. Lean into instrumentation: dense, precise, monospaced data, deliberate use of color as *signal* rather than decoration, and one memorable signature element (see below). Avoid the generic AI-dashboard defaults: no warm-cream-and-serif look, no near-black-with-single-neon-accent look, no broadsheet/newspaper hairline-column look, unless deliberately reinterpreted — follow the token system below instead.

**Color (6 named tokens):**
- `--bg`: `#0B0F14` — near-black graphite base (not pure black; has a cool undertone)
- `--surface`: `#131A22` — panel/card surface, sits just above bg
- `--border`: `#232B35` — hairline dividers/borders between panels
- `--text-primary`: `#E4E9EE`
- `--text-secondary`: `#8B96A3`
- `--accent-instrument`: `#4C8DFF` — interactive elements, focus rings, links, active nav

**Signal colors (status semantics only — never decorative):**
- Healthy/allowed: `#3DDC84` (muted teal-green)
- Caution/near-cap: `#F5A623` (amber)
- Stopped/denied/revoked: `#E5484D` (signal red, slightly desaturated so it doesn't scream)

**Type (2 roles, deliberately paired):**
- Display/headers/numeric data: **IBM Plex Mono** — reinforces the instrument-panel feel, and numbers (spend, caps, counts) should always use a monospaced, tabular-figure face so columns of numbers align.
- Body/UI copy: **IBM Plex Sans** — clean, purposeful, pairs naturally with Plex Mono without feeling like a mismatched combo.

**Layout concept:** modular panel/card grid with hairline borders (not soft shadows), dense information display appropriate for an operator (not consumer-app whitespace), a persistent top status bar (fleet health + emergency stop, visible on every page regardless of scroll), and a minimal left icon+label nav rail.

**Signature element — "Fleet Radar":** a live radial visualization on the Command Center home page showing every active agent instance as a small node arranged in orbits grouped by agent class, gently pulsing with activity, color-coded by status (healthy/caution/revoked/killed). This is the one bold, memorable piece of the design — keep everything else quiet and disciplined around it. The global Emergency Stop control should feel deliberately weighty and physical: a recessed button requiring a press-and-hold or explicit confirm step, never a single accidental click, with a satisfying "arm → confirm" two-stage motion given how serious the action is.

**Copy voice:** plain, active, exact. Buttons say what they do ("Revoke agent," "Stop fleet," not "Submit" or "Confirm"). Deny reasons in the activity feed and audit log are specific and factual ("Denied — spend cap exceeded (instance): $1,240 / $1,000 daily," not "Action blocked"). Empty states are invitations to act ("No bank systems connected yet — connect one to start routing agent traffic.").

Before building, briefly restate your own token/layout/signature plan and check it isn't just a generic dashboard default before writing code — then build to it.

## 4. Information architecture

Persistent chrome on every page:
- **Top status bar**: fleet status indicator (Healthy / Degraded / Stopped), global "Emergency Stop" control (press-and-hold or confirm-dialog), current operator name, notification bell.
- **Left nav rail**: Command Center, Agents, Agent Classes, Policies, Bank Connections, Activity, Audit Log, Settings.

Pages:

### 4.1 Command Center (home)
- Fleet Radar signature visualization (see §3), agents grouped by class, color-coded by status.
- Summary tiles: agents active, total spend today vs. total cap, denials in the last hour, current fleet status.
- Recent alerts panel: recent revocations, cap breaches, emergency stops (with timestamp and who/what triggered it).
- Quick links into Agents / Policies / Audit Log filtered to the relevant context.

### 4.2 Agents
- Table view: instance id, class, status (active/revoked), current spend / cap (progress bar, monospaced numbers), last action, last-seen timestamp. Filter by class, status, search by id.
- Row click opens an **Agent detail drawer/page**: effective permissions (inherited from class + instance overrides shown distinctly), instance-level caps vs. class-level caps, recent action history for this instance, a "Revoke this instance" control (confirm dialog).

### 4.3 Agent Classes
- List of classes with default allowed tools, default constraints, default caps, and instance count per class.
- Create/edit class form: name, allowed tools (multi-select from registered bank tools), constraint builder (parameter bounds, scope, time windows), default spend cap (amount + window), class-level "Revoke all instances" control.

### 4.4 Policies
- List of policies with scope (class/instance), type (visual / Rego), status (draft/active), last modified.
- **Visual policy builder tab**: form-based rule construction (allowed action + conditions) for common cases — no code required.
- **Rego editor tab**: code editor (syntax highlighting) for custom policy logic, with a "Validate" button (calls a parse/lint check) and a "Dry run" panel that evaluates the candidate policy against a sample of recent historical actions and shows a diff of what would change (which past actions would now be allowed/denied differently) before the operator activates it.

### 4.5 Bank Connections
- List of registered bank systems/connections: name, source type (native MCP / OpenAPI-derived / manual), tool count, status.
- **Add connection wizard**:
  1. Choose source: upload OpenAPI spec / paste URL / manual entry.
  2. Parsed endpoint list with checkboxes to select which become exposed tools; inline rename and grouping controls; flag for endpoints that couldn't be auto-converted.
  3. Auth setup: map the spec's security scheme to a credential entry (API key / Bearer / Basic / OAuth2 client credentials) — credential value fields are masked and never re-displayed after save.
  4. Review & publish.

### 4.6 Activity (live feed)
- Real-time (simulated) stream of individual action attempts: timestamp, agent, action, decision (allow/deny), reason if denied, latency. Filterable by agent/class/decision. Expandable row for full parameter detail.

### 4.7 Audit Log
- Full historical log with rich filters: agent, class, action type, outcome, bank connection, date range, free-text search. Export control. Visual indicator that entries are append-only/immutable. Includes config/policy change history (who changed what, old value → new value, when), not just agent actions.

### 4.8 Emergency Stop
- Dedicated page (in addition to the always-visible top-bar control): fleet-wide stop, per-class stop, per-instance stop, each with a clear confirm step. History of past stop/resume events with who triggered them and when.

### 4.9 Settings
- Default spend cap templates, notification preferences, operator/role list (can be a simple stub for a single-operator hackathon build).

## 5. Interaction details worth getting right

- Every destructive/high-consequence action (revoke, emergency stop) uses a deliberate two-step confirm — never a single click with no confirmation.
- Numbers that represent money or counts always render in the monospaced type with tabular figures so they align in columns/tables.
- Status color always pairs with a text label, never color alone (accessibility).
- Deny reasons are always specific and sourced from the actual policy/cap that triggered them, never generic.
- Visible keyboard focus states throughout; respect reduced-motion preference for the Fleet Radar's pulsing animation.

## 6. Data contracts (for building against mock data)

```ts
type AgentClass = {
  id: string;
  name: string;
  allowedTools: string[];
  defaultConstraints: Record<string, unknown>;
  defaultCap: { amount: number; window: "day" | "month" };
  instanceCount: number;
};

type AgentInstance = {
  id: string;
  classId: string;
  status: "active" | "revoked";
  spendToday: number;
  capToday: number;
  lastAction: string;
  lastSeen: string; // ISO timestamp
};

type BankConnection = {
  id: string;
  name: string;
  sourceType: "native_mcp" | "openapi" | "manual";
  toolCount: number;
  status: "connected" | "error" | "pending";
};

type Policy = {
  id: string;
  scope: "class" | "instance";
  targetId: string;
  type: "visual" | "rego";
  status: "draft" | "active";
  lastModified: string;
  regoSource?: string;
};

type ActivityEvent = {
  id: string;
  timestamp: string;
  agentId: string;
  agentClass: string;
  action: string;
  params: Record<string, unknown>;
  decision: "allow" | "deny";
  reason?: string;
  latencyMs: number;
};

type AuditLogEntry = ActivityEvent & {
  bankConnectionId?: string;
};
```

## 7. Deliverable

A working React app with the pages above, populated with realistic mock data (multiple agent classes, several instances each in varying states, a live-updating activity feed via a simulated interval, and a populated audit log), built against the token/type contracts above so a real backend can be wired in later without redesigning components.
