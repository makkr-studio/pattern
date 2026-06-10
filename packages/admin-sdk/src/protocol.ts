/**
 * @pattern/admin-sdk — wire protocol (mod-admin-spec §9, §10).
 *
 * The data shapes the admin API speaks over HTTP. These mirror the `admin.*` op
 * I/O; the SDK owns them as the *client-facing contract* (the backend produces
 * structurally-compatible values). Kept dependency-light so any UI can import
 * them; richer engine types come from `@pattern/core`.
 */

import type { PortKind, MenuEntry, CommandDef, DeclarativeView } from "@pattern/core";

export type { MenuEntry, CommandDef, DeclarativeView } from "@pattern/core";

export interface UiManifestPage {
  path: string;
  view?: DeclarativeView;
  remote?: string;
  tier2?: boolean;
}

export interface UiManifest {
  menu: MenuEntry[];
  commands: CommandDef[];
  assets: Array<{ mod: string; assets: string }>;
  pages: UiManifestPage[];
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

/** A workflow document (kept loose here; `@pattern/core`'s `Workflow` is exact). */
export interface WorkflowDoc {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  source?: Source;
  nodes: Array<{ id: string; op: string; title?: string; comment?: string; config?: unknown; ui?: { x: number; y: number; [k: string]: unknown } }>;
  edges: Array<{ from: { node: string; port: string }; to: { node: string; port: string } }>;
}

export interface ValidationIssue {
  nodeId?: string;
  port?: string;
  path?: string;
  message: string;
  code: string;
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
  status: "ok" | "error" | "running";
  startTime: number;
  endTime?: number;
  durationMs?: number;
  spanCount: number;
  error?: { message: string };
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
