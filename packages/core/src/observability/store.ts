/**
 * Pattern — the trace store abstraction (§10).
 *
 * Core emits OTLP-shaped spans and **stores nothing itself**. A `TraceStore` is
 * the durable (or in-memory) home for that telemetry: it is a `TraceSink` on the
 * write side and exposes the read surface the admin needs (run list, run detail
 * with spans, sub-runs, metrics, a live span tail). Implementations live in the
 * adapter layer (runtime-node ships an in-memory store and a SQLite one) so the
 * backend can be swapped — another DB, a remote service — without touching core,
 * the engine, or the admin. The read methods are async so a network/Postgres
 * backend fits; the in-memory and `node:sqlite` impls just resolve immediately.
 */

import type { Principal, RunParentRef, SpanData, TraceSink } from "../types.js";

/** A finished-or-running run, as the admin lists it. */
export interface RunSummary {
  runId: string;
  traceId: string;
  workflowId: string;
  trigger: string;
  principal: Principal;
  status: "ok" | "error" | "running" | "streaming";
  /** epoch ms */
  startTime: number;
  /** epoch ms; undefined while running */
  endTime?: number;
  /** Total run time, start → true end (all streams drained). */
  durationMs?: number;
  /** Time to result-ready (out-gates captured). For a streaming run this is ≪
   *  durationMs — "ready in X · streamed Y"; ≈ durationMs for non-streaming. */
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

/** A run plus its node spans (the run-detail / replay payload). */
export interface RunDetail {
  summary: RunSummary;
  spans: SpanData[];
}

/** Per-workflow latency aggregate over a metrics window. */
export interface LatencyStats {
  workflowId: string;
  count: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  maxMs: number;
}

/** Rolling throughput/error aggregate for the metrics strip. */
export interface MetricsSummary {
  /** The window these figures cover. */
  window: { label: string; sinceBoot: boolean; minutes?: number };
  runs: number;
  errors: number;
  errorRate: number;
  inFlight: number;
  runsPerMin: number;
  perWorkflow: LatencyStats[];
}

/**
 * Engine service key under which the host (`loadProject`) provides the durable
 * `TraceStore`. A consumer (the admin) reads it via `engine.service(TRACE_STORE)`
 * and falls back to its own in-memory store when absent (standalone / tests).
 */
export const TRACE_STORE = "traceStore";

/** Filter for {@link TraceStore.list}. */
export interface RunFilter {
  workflow?: string;
  status?: string;
  limit?: number;
}

/** Current retention/exclusion config (for the settings UI). */
export interface TraceStoreConfig {
  capacity: number;
  exclude: string | null;
}

/**
 * The durable home for run telemetry. Write side = the `TraceSink` callbacks
 * (the engine drives them synchronously); read side = the async queries the
 * admin's run/metrics ops call. `tail` is a live, process-local span stream.
 */
export interface TraceStore extends TraceSink {
  /** Recent runs, newest first, in-flight runs surfaced at the top. */
  list(filter?: RunFilter): Promise<RunSummary[]>;
  /** One run with its node spans (incl. events + I/O samples for replay). */
  get(runId: string): Promise<RunDetail | null>;
  /** Sub-runs this run started via `ctx.invoke`, oldest first. */
  children(runId: string): Promise<RunSummary[]>;
  /** Windowed throughput/latency aggregate. */
  metrics(window?: { minutes?: number }): Promise<MetricsSummary>;
  /** A live stream of node spans, optionally filtered to one workflow (SSE tail).
   *  Process-local: only spans seen by this store's process flow through it. */
  tail(workflowId?: string): ReadableStream<SpanData>;
  /** Current retention/exclusion, for the settings UI. */
  config(): TraceStoreConfig;
  /** Resize the ring/retention (trims beyond the cap). */
  setCapacity(n: number): void;
  /** Workflow-id exclusion regex (null/"" disables). Throws on a bad pattern. */
  setExclude(pattern: string | null): void;
  /** Release the backend (close the DB handle). */
  close(): Promise<void>;
}
