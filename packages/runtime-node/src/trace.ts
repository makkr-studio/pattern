/**
 * @pattern/runtime-node — persistence sinks for telemetry (§10).
 *
 * Core emits OTLP-shaped spans and stores nothing. These optional sinks live in
 * the adapter (where host I/O is allowed): a zero-dependency JSONL file sink, and
 * a SQLite sink built on Node's experimental `node:sqlite` when available.
 */

import { appendFileSync } from "node:fs";
import type { Principal, SpanData, TraceSink } from "@pattern/core";

/** Append every run/span event as one JSON object per line. */
export function jsonlTraceSink(filePath: string): TraceSink {
  const write = (obj: unknown) => appendFileSync(filePath, JSON.stringify(obj) + "\n");
  return {
    onRunStart(run) {
      write({ kind: "run.start", ts: Date.now(), ...run });
    },
    onSpanEnd(span: SpanData) {
      write({ kind: "span", ...span });
    },
    onRunEnd(run) {
      write({ kind: "run.end", ts: Date.now(), ...run });
    },
  };
}

/**
 * Persist runs + spans to SQLite via `node:sqlite`. Returns the sink and a
 * `close()`. Throws a helpful error if `node:sqlite` is unavailable on this Node.
 */
export async function sqliteTraceSink(
  filePath: string,
): Promise<{ sink: TraceSink; close: () => void }> {
  let DatabaseSync: any;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    throw new Error(
      "node:sqlite is not available in this Node build. Use jsonlTraceSink, or run Node ≥22.5 (may need --experimental-sqlite).",
    );
  }
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY, trace_id TEXT, workflow_id TEXT, trigger TEXT,
      principal TEXT, status TEXT, started_at INTEGER, ended_at INTEGER, error TEXT
    );
    CREATE TABLE IF NOT EXISTS spans (
      span_id TEXT PRIMARY KEY, trace_id TEXT, parent_span_id TEXT, name TEXT,
      start_time INTEGER, end_time INTEGER, status TEXT, attributes TEXT, error TEXT
    );
  `);
  const insertRun = db.prepare(
    "INSERT OR REPLACE INTO runs (run_id, trace_id, workflow_id, trigger, principal, status, started_at) VALUES (?,?,?,?,?,?,?)",
  );
  const endRun = db.prepare("UPDATE runs SET status=?, ended_at=?, error=? WHERE run_id=?");
  const insertSpan = db.prepare(
    "INSERT OR REPLACE INTO spans (span_id, trace_id, parent_span_id, name, start_time, end_time, status, attributes, error) VALUES (?,?,?,?,?,?,?,?,?)",
  );

  const sink: TraceSink = {
    onRunStart(run: { runId: string; traceId: string; workflowId: string; trigger: string; principal: Principal }) {
      insertRun.run(run.runId, run.traceId, run.workflowId, run.trigger, JSON.stringify(run.principal), "running", Date.now());
    },
    onSpanEnd(span: SpanData) {
      insertSpan.run(
        span.spanId,
        span.traceId,
        span.parentSpanId ?? null,
        span.name,
        span.startTime,
        span.endTime,
        span.status,
        JSON.stringify(span.attributes),
        span.error ? JSON.stringify(span.error) : null,
      );
    },
    onRunEnd(run: { runId: string; status: string; error?: unknown }) {
      endRun.run(run.status, Date.now(), run.error ? JSON.stringify(String((run.error as any)?.message ?? run.error)) : null, run.runId);
    },
  };
  return { sink, close: () => db.close() };
}
