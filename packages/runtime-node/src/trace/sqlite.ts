/**
 * @pattern-js/runtime-node — durable trace store on Node's `node:sqlite` (§10).
 *
 * The same `TraceStore` surface as the in-memory one, persisted to a SQLite file
 * so runs survive restarts and any process writing the file (host, CLI) shows up
 * in the admin. Hand-written SQL, no ORM, mirroring mod-store's driver: WAL for
 * multi-process readers, one row per run + one per span (events + I/O samples
 * stored as JSON so Replay scrubs straight from the DB). The live `tail()` stays
 * an in-memory fan-out — a live SSE span feed is inherently process-local.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  now as hiResNow,
  type LatencyStats,
  type MetricsSummary,
  type Principal,
  type RunDetail,
  type RunFilter,
  type RunParentRef,
  type RunSummary,
  type SpanData,
  type TraceStore,
  type TraceStoreConfig,
} from "@pattern-js/core";

/** Minimal slice of node:sqlite's DatabaseSync this module needs. */
interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

type Raw = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS trace_runs (
  run_id        TEXT PRIMARY KEY,
  trace_id      TEXT NOT NULL,
  workflow_id   TEXT NOT NULL,
  trigger       TEXT NOT NULL,
  principal     TEXT NOT NULL,
  status        TEXT NOT NULL,
  start_time    REAL NOT NULL,
  end_time      REAL,
  duration_ms   REAL,
  ready_ms      REAL,
  ended_by      TEXT,
  executor      TEXT,
  span_count    INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  parent        TEXT,
  parent_run_id TEXT,
  finished      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_trace_runs_trace    ON trace_runs(trace_id);
CREATE INDEX IF NOT EXISTS idx_trace_runs_parent   ON trace_runs(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_trace_runs_finished ON trace_runs(finished, start_time);

CREATE TABLE IF NOT EXISTS trace_spans (
  span_id        TEXT PRIMARY KEY,
  trace_id       TEXT NOT NULL,
  parent_span_id TEXT,
  name           TEXT NOT NULL,
  start_time     REAL NOT NULL,
  end_time       REAL NOT NULL,
  status         TEXT NOT NULL,
  attributes     TEXT,
  events         TEXT,
  io             TEXT,
  error          TEXT
);
CREATE INDEX IF NOT EXISTS idx_trace_spans_trace ON trace_spans(trace_id);
`;

const jparse = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== "string") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

function toSummary(r: Raw): RunSummary {
  return {
    runId: String(r.run_id),
    traceId: String(r.trace_id),
    workflowId: String(r.workflow_id),
    trigger: String(r.trigger),
    principal: jparse<Principal>(r.principal, { kind: "anonymous" } as Principal),
    status: String(r.status) as RunSummary["status"],
    startTime: Number(r.start_time),
    endTime: r.end_time == null ? undefined : Number(r.end_time),
    durationMs: r.duration_ms == null ? undefined : Number(r.duration_ms),
    readyMs: r.ready_ms == null ? undefined : Number(r.ready_ms),
    endedBy: (r.ended_by as RunSummary["endedBy"]) ?? undefined,
    executor: (r.executor as string | null) ?? undefined,
    spanCount: Number(r.span_count),
    error: r.error == null ? undefined : jparse<{ message: string }>(r.error, { message: String(r.error) }),
    parent: r.parent == null ? undefined : jparse<RunParentRef | undefined>(r.parent, undefined),
  };
}

function toSpan(r: Raw): SpanData {
  return {
    traceId: String(r.trace_id),
    spanId: String(r.span_id),
    parentSpanId: (r.parent_span_id as string | null) ?? undefined,
    name: String(r.name),
    startTime: Number(r.start_time),
    endTime: Number(r.end_time),
    attributes: jparse<Record<string, unknown>>(r.attributes, {}),
    events: jparse<SpanData["events"]>(r.events, []),
    status: String(r.status) as SpanData["status"],
    error: r.error == null ? undefined : jparse<{ message: string; stack?: string }>(r.error, { message: String(r.error) }),
    io: r.io == null ? undefined : jparse<SpanData["io"]>(r.io, undefined),
  };
}

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
};

export interface SqliteTraceStoreOptions {
  capacity?: number;
  now?: () => number;
}

export class SqliteTraceStore implements TraceStore {
  private capacity: number;
  private readonly now: () => number;
  private readonly bootTime: number;
  private exclude: RegExp | null = null;
  private excludeSource: string | null = null;
  private readonly excludedTraces = new Set<string>();
  private readonly subscribers = new Set<{ workflowId?: string; push: (s: SpanData) => void; close: () => void }>();

  constructor(
    private readonly db: SqlDatabase,
    opts: SqliteTraceStoreOptions = {},
  ) {
    this.capacity = opts.capacity ?? 500;
    this.now = opts.now ?? hiResNow;
    this.bootTime = this.now();
  }

  config(): TraceStoreConfig {
    return { capacity: this.capacity, exclude: this.excludeSource };
  }

  setCapacity(n: number): void {
    this.capacity = Math.max(10, Math.min(10_000, Math.floor(n)));
    this.prune();
  }

  setExclude(pattern: string | null): void {
    if (!pattern) {
      this.exclude = null;
      this.excludeSource = null;
      return;
    }
    this.exclude = new RegExp(pattern);
    this.excludeSource = pattern;
  }

  // ── Write side (TraceSink) ──

  onRunStart(run: {
    runId: string;
    traceId: string;
    workflowId: string;
    trigger: string;
    principal: Principal;
    parent?: RunParentRef;
    executor?: string;
  }): void {
    if (this.exclude?.test(run.workflowId)) {
      this.excludedTraces.add(run.traceId);
      return;
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO trace_runs
         (run_id, trace_id, workflow_id, trigger, principal, status, start_time, span_count, executor, parent, parent_run_id, finished)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
      )
      .run(
        run.runId,
        run.traceId,
        run.workflowId,
        run.trigger,
        JSON.stringify(run.principal),
        "running",
        this.now(),
        0,
        run.executor ?? null,
        run.parent ? JSON.stringify(run.parent) : null,
        run.parent?.runId ?? null,
      );
  }

  onSpanEnd(span: SpanData): void {
    if (this.excludedTraces.has(span.traceId)) return;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO trace_spans
         (span_id, trace_id, parent_span_id, name, start_time, end_time, status, attributes, events, io, error)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        span.spanId,
        span.traceId,
        span.parentSpanId ?? null,
        span.name,
        span.startTime,
        span.endTime,
        span.status,
        JSON.stringify(span.attributes ?? {}),
        span.events ? JSON.stringify(span.events) : null,
        span.io ? JSON.stringify(span.io) : null,
        span.error ? JSON.stringify(span.error) : null,
      );
    this.db.prepare("UPDATE trace_runs SET span_count = span_count + 1 WHERE trace_id = ?").run(span.traceId);
    // Fan out to live tail subscribers (node spans only — skip the run span).
    if (span.attributes["pattern.node.id"] !== undefined) {
      const r = this.db.prepare("SELECT workflow_id FROM trace_runs WHERE trace_id = ?").get(span.traceId) as Raw | undefined;
      const wf = r ? String(r.workflow_id) : undefined;
      for (const sub of this.subscribers) if (!sub.workflowId || sub.workflowId === wf) sub.push(span);
    }
  }

  onRunReady(run: { runId: string; traceId: string; status: "ok" | "error" | "canceled"; at: number }): void {
    if (this.excludedTraces.has(run.traceId)) return;
    const r = this.db.prepare("SELECT start_time FROM trace_runs WHERE trace_id = ?").get(run.traceId) as Raw | undefined;
    if (!r) return;
    const readyMs = Math.max(0, run.at - Number(r.start_time));
    // Errors are terminal at ready; ok runs may still be draining a stream.
    this.db
      .prepare("UPDATE trace_runs SET ready_ms = ?, status = CASE WHEN ? = 'ok' THEN 'streaming' ELSE status END WHERE trace_id = ?")
      .run(readyMs, run.status, run.traceId);
  }

  onRunEnd(run: {
    runId: string;
    traceId: string;
    status: "ok" | "error" | "canceled";
    error?: unknown;
    at?: number;
    endedBy?: "drain" | "timeout";
  }): void {
    if (this.excludedTraces.delete(run.traceId)) return;
    const r = this.db.prepare("SELECT start_time FROM trace_runs WHERE trace_id = ?").get(run.traceId) as Raw | undefined;
    if (!r) return;
    const endTime = run.at ?? this.now();
    const durationMs = endTime - Number(r.start_time);
    const error = run.error !== undefined ? JSON.stringify({ message: run.error instanceof Error ? run.error.message : String(run.error) }) : null;
    this.db
      .prepare("UPDATE trace_runs SET status = ?, end_time = ?, duration_ms = ?, ended_by = ?, error = ?, finished = 1 WHERE trace_id = ?")
      .run(run.status, endTime, durationMs, run.endedBy ?? null, error, run.traceId);
    this.prune();
  }

  /** Keep at most `capacity` finished runs; drop the oldest + their spans. */
  private prune(): void {
    const c = this.db.prepare("SELECT COUNT(*) AS n FROM trace_runs WHERE finished = 1").get() as Raw;
    if (Number(c.n) <= this.capacity) return;
    this.db
      .prepare(
        `DELETE FROM trace_runs WHERE finished = 1 AND run_id NOT IN (
           SELECT run_id FROM trace_runs WHERE finished = 1 ORDER BY start_time DESC LIMIT ?
         )`,
      )
      .run(this.capacity);
    this.db.prepare("DELETE FROM trace_spans WHERE trace_id NOT IN (SELECT trace_id FROM trace_runs)").run();
  }

  // ── Read side (TraceStore) ──

  async list(filter: RunFilter = {}): Promise<RunSummary[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.workflow) {
      where.push("workflow_id = ?");
      params.push(filter.workflow);
    }
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    // In-flight (finished = 0) first, then newest started first.
    const rows = this.db
      .prepare(`SELECT * FROM trace_runs ${clause} ORDER BY finished ASC, start_time DESC LIMIT ?`)
      .all(...params, filter.limit ?? 50) as Raw[];
    return rows.map(toSummary);
  }

  async get(runId: string): Promise<RunDetail | null> {
    const r = this.db.prepare("SELECT * FROM trace_runs WHERE run_id = ?").get(runId) as Raw | undefined;
    if (!r) return null;
    const spans = this.db
      .prepare("SELECT * FROM trace_spans WHERE trace_id = ? ORDER BY rowid ASC")
      .all(String(r.trace_id)) as Raw[];
    return { summary: toSummary(r), spans: spans.map(toSpan) };
  }

  async children(runId: string): Promise<RunSummary[]> {
    const rows = this.db
      .prepare("SELECT * FROM trace_runs WHERE parent_run_id = ? ORDER BY start_time ASC")
      .all(runId) as Raw[];
    return rows.map(toSummary);
  }

  tail(workflowId?: string): ReadableStream<SpanData> {
    let sub: { workflowId?: string; push: (s: SpanData) => void; close: () => void };
    return new ReadableStream<SpanData>({
      start: (controller) => {
        sub = {
          workflowId,
          push: (s) => {
            try {
              controller.enqueue(s);
            } catch {
              /* closed */
            }
          },
          close: () => {
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          },
        };
        this.subscribers.add(sub);
      },
      cancel: () => {
        this.subscribers.delete(sub);
      },
    });
  }

  async metrics(window?: { minutes?: number }): Promise<MetricsSummary> {
    const minutes = window?.minutes;
    const since = minutes ? this.now() - minutes * 60_000 : this.bootTime;
    const rows = this.db
      .prepare("SELECT workflow_id, status, duration_ms FROM trace_runs WHERE finished = 1 AND start_time >= ?")
      .all(since) as Raw[];

    const durations = new Map<string, number[]>();
    const errors = new Map<string, number>();
    let totalErrors = 0;
    for (const r of rows) {
      const wf = String(r.workflow_id);
      if (r.duration_ms != null) {
        const list = durations.get(wf) ?? [];
        list.push(Number(r.duration_ms));
        durations.set(wf, list);
      }
      if (r.status === "error") {
        errors.set(wf, (errors.get(wf) ?? 0) + 1);
        totalErrors++;
      }
    }

    const perWorkflow: LatencyStats[] = [];
    for (const [workflowId, ds] of durations) {
      const sorted = [...ds].sort((a, b) => a - b);
      perWorkflow.push({
        workflowId,
        count: sorted.length,
        errors: errors.get(workflowId) ?? 0,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        maxMs: sorted[sorted.length - 1] ?? 0,
      });
    }
    perWorkflow.sort((a, b) => b.count - a.count);

    const inflight = this.db.prepare("SELECT COUNT(*) AS n FROM trace_runs WHERE finished = 0").get() as Raw;
    const elapsedMin = Math.max((this.now() - since) / 60_000, 1 / 60);
    return {
      window: minutes ? { label: `last ${minutes}m`, sinceBoot: false, minutes } : { label: "since boot", sinceBoot: true },
      runs: rows.length,
      errors: totalErrors,
      errorRate: rows.length ? totalErrors / rows.length : 0,
      inFlight: Number(inflight.n),
      runsPerMin: rows.length / elapsedMin,
      perWorkflow,
    };
  }

  async close(): Promise<void> {
    for (const sub of this.subscribers) sub.close();
    this.subscribers.clear();
    this.db.close();
  }
}

/** Open (or create) a SQLite-backed trace store at `path` (":memory:" works).
 *  Throws helpfully when `node:sqlite` is missing — the factory falls back. */
export async function openSqliteTraceStore(path: string, opts: SqliteTraceStoreOptions = {}): Promise<SqliteTraceStore> {
  let DatabaseSync: (new (p: string) => SqlDatabase) | undefined;
  try {
    DatabaseSync = (process.getBuiltinModule("node:sqlite") as never as { DatabaseSync: never } | undefined)?.DatabaseSync;
  } catch {
    /* fall through */
  }
  if (!DatabaseSync) {
    throw new Error(
      "node:sqlite is not available in this Node build — trace persistence needs Node ≥22.5 (≥24 recommended).",
    );
  }
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  // Multi-process: a CLI run, or a dev-server restart, may open the file while
  // another connection holds the write lock — wait for it instead of failing
  // (which would silently drop this process to the in-memory fallback).
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  return new SqliteTraceStore(db, opts);
}
