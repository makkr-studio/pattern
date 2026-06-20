/**
 * @pattern-js/admin-sdk — wire protocol (admin internals §9, §10).
 *
 * The data shapes the admin API speaks over HTTP. These mirror the `admin.*` op
 * I/O; the SDK owns them as the *client-facing contract* (the backend produces
 * structurally-compatible values). Kept dependency-light so any UI can import
 * them; richer engine types come from `@pattern-js/core`.
 */

import type { PortKind, MenuEntry, CommandDef, DeclarativeView, SettingsSection } from "@pattern-js/core";

export type { MenuEntry, CommandDef, DeclarativeView, SettingsField, SettingsSection } from "@pattern-js/core";

/** One node's config-resolved ports (admin.doc.ports). */
export interface NodePorts {
  inputs: PortInfo[];
  outputs: PortInfo[];
  configInputs: PortInfo[];
  controlOut: string[];
}

export interface UiManifestPage {
  path: string;
  view?: DeclarativeView;
  /** Stacked views (detail-style pages); each section may carry a title. */
  views?: Array<{ title?: string; view: DeclarativeView }>;
  remote?: string;
  tier2?: boolean;
}

export interface UiManifest {
  menu: MenuEntry[];
  commands: CommandDef[];
  assets: Array<{ mod: string; assets: string }>;
  pages: UiManifestPage[];
  /** Mod-contributed Settings-page sections. */
  settings?: Array<{ mod: string; section: SettingsSection }>;
  /** Whether any auth provider is registered — i.e. whether a `requireAuth` is
   *  actually enforced (vs. declared-but-advisory). The editor warns when false. */
  authProvider?: boolean;
}

export type Source = "code" | "file" | "db";
export type VersionId = string;

export interface VersionInfo {
  id: VersionId;
  hash: string;
  note?: string;
  author?: string;
  createdAt: string;
}

export interface RouteInfo {
  method: string;
  path: string;
  port?: number;
}

/** What an audit entry records — mirrors the backend's control-plane union so
 *  SDK consumers can switch-exhaust on it. */
export type AuditAction =
  | "create"
  | "save"
  | "activate"
  | "rollback"
  | "disable"
  | "enable"
  | "delete"
  | "fork"
  | "import";

export interface AuditEntry {
  at: string;
  principal: unknown;
  action: AuditAction;
  version?: VersionId;
  note?: string;
}

export interface WorkflowMeta {
  slug: string;
  name: string;
  description?: string;
  source: Source;
  enabled: boolean;
  live: VersionId | null;
  route?: RouteInfo;
  tags?: string[];
  versions: VersionInfo[];
  audit: AuditEntry[];
}

/** A workflow document (kept loose here; `@pattern-js/core`'s `Workflow` is exact). */
export interface WorkflowDoc {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  source?: Source;
  /** Run this workflow off the host event loop on the worker pool (opt-in). */
  offload?: boolean;
  nodes: Array<{ id: string; op: string; title?: string; comment?: string; config?: unknown; ui?: { x: number; y: number; [k: string]: unknown } }>;
  edges: Array<{ from: { node: string; port: string }; to: { node: string; port: string }; ui?: { portal?: string; [k: string]: unknown } }>;
  /** Visual annotation boxes (data-only; engine-ignored, hash-ignored). */
  frames?: Array<{ id: string; label?: string; comment?: string; x: number; y: number; w: number; h: number; hue?: number }>;
}

export interface ValidationIssue {
  nodeId?: string;
  port?: string;
  path?: string;
  message: string;
  code: string;
  /** "error" (default) blocks; "warning" is advisory (surfaced, never blocking). */
  severity?: "error" | "warning";
}

export interface PortInfo {
  name: string;
  kind: PortKind;
  required?: boolean;
  description?: string;
  schema?: unknown;
}

export interface OpInfo {
  type: string;
  title?: string;
  description?: string;
  category: string;
  boundary?: "trigger" | "outgate";
  /** Boundary ops: the op type of the canonical partner (trigger ↔ out-gate). */
  pair?: string;
  mod?: string;
  inputs: PortInfo[];
  outputs: PortInfo[];
  /** Registration-time config ports (boundary ops) — wired like value inputs. */
  configInputs: PortInfo[];
  controlOut: string[];
  configSchema?: unknown;
  usedBy: number;
  /** Ids of the workflows using this op (clickable in the catalog). */
  usedByWorkflows?: string[];
  reusable: boolean;
  /** Does meaningful synchronous compute — the editor nudges toward Offload. */
  cpuHeavy?: boolean;
}

export interface ModInfo {
  name: string;
  ops: string[];
  workflows: string[];
  frontend?: { menu: number; pages: number; commands: number; assets?: string };
}

export interface PortRef {
  op: string;
  port: string;
  dir: "in" | "out";
}

export interface PortCompatibility {
  ok: boolean;
  reason?: string;
  fix?: "accumulate" | "emit";
}

export interface RunSummary {
  runId: string;
  traceId: string;
  workflowId: string;
  trigger: string;
  principal: unknown;
  status: "ok" | "error" | "running" | "streaming";
  startTime: number;
  endTime?: number;
  /** Total run time, start → true end (all streams drained). */
  durationMs?: number;
  /** Time to result-ready (out-gates captured); ≪ durationMs for streaming runs. */
  readyMs?: number;
  /** How the run truly ended (drain vs the TTL backstop). */
  endedBy?: "drain" | "timeout";
  spanCount: number;
  error?: { message: string };
  /** Set when this run was started by another run (`ctx.invoke`). */
  parent?: RunParentRef;
  /** Where the run executed when not the host loop (e.g. "worker:3"). */
  executor?: string;
}

/** The run + node that started a sub-run via `ctx.invoke`. */
export interface RunParentRef {
  runId: string;
  workflowId: string;
  nodeId: string;
}

export interface SpanIoSample {
  kind: "value" | "stream";
  preview?: unknown;
  head?: unknown[];
  count?: number;
  truncated?: boolean;
}

export interface SpanEvent {
  name: string;
  time: number;
  attributes?: Record<string, unknown>;
}

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime: number;
  attributes: Record<string, unknown>;
  status: "unset" | "ok" | "error";
  error?: { message: string; stack?: string };
  events?: SpanEvent[];
  io?: { inputs?: Record<string, SpanIoSample>; outputs?: Record<string, SpanIoSample> };
}

export interface RunDetail {
  summary: RunSummary;
  spans: SpanData[];
  /** Still executing right now (cancellable / pausable). */
  inflight?: boolean;
  /** Currently held at the pause gate. */
  paused?: boolean;
  /** Sub-runs this run started via `ctx.invoke`, oldest first. */
  children?: RunSummary[];
}

export interface LatencyStats {
  workflowId: string;
  count: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  maxMs: number;
}

export interface MetricsSummary {
  window: { label: string; sinceBoot: boolean; minutes?: number };
  runs: number;
  errors: number;
  errorRate: number;
  inFlight: number;
  runsPerMin: number;
  perWorkflow: LatencyStats[];
}

export interface NodeChange {
  id: string;
  before: { op: string; config?: unknown; title?: string; comment?: string };
  after: { op: string; config?: unknown; title?: string; comment?: string };
}

export interface DiffNode {
  id: string;
  op: string;
  [k: string]: unknown;
}

export interface DiffEdge {
  from: { node: string; port: string };
  to: { node: string; port: string };
}

export interface JsonDiff {
  equal: boolean;
  nodes: { added: DiffNode[]; removed: DiffNode[]; changed: NodeChange[] };
  edges: { added: DiffEdge[]; removed: DiffEdge[] };
  meta: { field: string; before: unknown; after: unknown }[];
}

export interface RouteConflict {
  route: RouteInfo;
  conflictsWith: string;
}

export type DeployResult = { ok: true; version: VersionId } | { ok: false; conflicts: RouteConflict[] };

export interface Template {
  id: string;
  name: string;
  description: string;
  doc: WorkflowDoc;
}

export interface SystemMap {
  routes: Array<{ method: string; path: string; port?: number; workflow: string; conflict: boolean }>;
  apps: Array<{ mount: string; port?: number; workflow: string; filesystem: string }>;
  schedules: Array<{ workflow: string; node: string; cron?: string; intervalMs?: number }>;
  hooks: Array<{ hook: string; workflow: string; node: string; priority: number }>;
  events: Array<{ event: string; workflow: string; node: string }>;
  ws: Array<{ workflow: string; node: string; kind: string }>;
  ports: number[];
}

export interface WorkflowGetResult {
  meta: WorkflowMeta | null;
  liveDoc: WorkflowDoc | null;
  /** Newest saved version — what the editor opens (≥ liveDoc; null when none). */
  latestDoc?: WorkflowDoc | null;
  safeConfigs?: Record<string, unknown>;
}

export interface SaveResult {
  version?: VersionInfo;
  issues: ValidationIssue[];
}

export type RunResult =
  | { ok: false; issues: ValidationIssue[] }
  | { ok: true; runId: string; status: "ok" | "error"; outputs: Record<string, Record<string, unknown>>; error?: string };

export interface RunInput {
  slug?: string;
  doc?: WorkflowDoc;
  trigger?: string;
  input?: Record<string, unknown>;
  params?: Record<string, unknown>;
  /** Caller-chosen run id (a UUID you mint) — lets you cancel/pause the run
   *  you just started before its result (and server id) comes back. */
  runId?: string;
}
