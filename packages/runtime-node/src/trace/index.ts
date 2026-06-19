/**
 * @pattern/runtime-node — trace persistence (§10).
 *
 * Core emits OTLP-shaped spans and stores nothing. These adapters give that
 * telemetry a home behind core's `TraceStore`: an in-memory ring buffer, a
 * durable SQLite store, and a zero-dependency JSONL append sink. `createTraceStore`
 * picks the backend (durable by default, gracefully degrading to memory when
 * `node:sqlite` is unavailable) so the host, workers, and the CLI all record the
 * same way.
 */

import { appendFileSync } from "node:fs";
import type { SpanData, TraceSink, TraceStore } from "@pattern/core";

export { MemoryTraceStore, type MemoryTraceStoreOptions } from "./memory.js";
export { SqliteTraceStore, openSqliteTraceStore, type SqliteTraceStoreOptions } from "./sqlite.js";

import { MemoryTraceStore } from "./memory.js";
import { openSqliteTraceStore } from "./sqlite.js";

export interface CreateTraceStoreOptions {
  /** "sqlite" (durable, default) or "memory". */
  kind?: "sqlite" | "memory";
  /** DB path for the sqlite backend (default "./.pattern/traces.db"; ":memory:" works). */
  path?: string;
  /** Retention: max finished runs kept. Default 500. */
  capacity?: number;
  /** Clock override (tests). */
  now?: () => number;
}

/**
 * Open a `TraceStore`. Durable SQLite by default; if `node:sqlite` is missing on
 * this Node build it logs a one-line warning and falls back to the in-memory
 * store so the admin keeps working (just non-durable).
 */
export async function createTraceStore(opts: CreateTraceStoreOptions = {}): Promise<TraceStore> {
  const { kind = "sqlite", path = "./.pattern/traces.db", capacity, now } = opts;
  if (kind === "memory") return new MemoryTraceStore({ capacity, now });
  try {
    return await openSqliteTraceStore(path, { capacity, now });
  } catch (err) {
    console.warn(`[pattern] trace persistence unavailable, using in-memory store: ${(err as Error).message}`);
    return new MemoryTraceStore({ capacity, now });
  }
}

/** Append every run/span event as one JSON object per line (debug/export). */
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
