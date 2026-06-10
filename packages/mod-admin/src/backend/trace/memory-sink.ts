/**
 * @pattern/mod-admin — in-memory trace sink (mod-admin-spec T4, §15.1, §15.11).
 *
 * A bounded ring buffer of recent runs (+ their node spans) plus rolling
 * aggregates: windowed run/error counters and a per-workflow latency histogram.
 * Powers the runs list, run-replay (reads stored spans + opt-in I/O samples),
 * live tail (a span stream wired to an SSE out-gate), and the metrics strip.
 *
 * Emit-don't-persist: this lives in the mod and subscribes via `engine.onTrace`.
 * Windows are labelled honestly (since-boot / last N minutes).
 */

import type { Principal, SpanData, TraceSink } from "@pattern/core";

export interface RunSummary {
  runId: string;
  traceId: string;
  workflowId: string;
  trigger: string;
  principal: Principal;
  status: "ok" | "error" | "running";
  /** epoch ms */
  startTime: number;
  /** epoch ms; undefined while running */
  endTime?: number;
  durationMs?: number;
  spanCount: number;
  error?: { message: string };
}

export interface RunDetail {
  summary: RunSummary;
  spans: SpanData[];
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
  /** The window these figures cover. */
  window: { label: string; sinceBoot: boolean; minutes?: number };
  runs: number;
  errors: number;
  errorRate: number;
  inFlight: number;
  runsPerMin: number;
  perWorkflow: LatencyStats[];
}

interface InProgress {
  summary: RunSummary;
  spans: SpanData[];
}

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
};

export interface MemoryTraceSinkOptions {
  /** Max finished runs retained in the ring buffer. Default 500. */
  capacity?: number;
  /** Clock (overridable in tests). Default `Date.now`. */
  now?: () => number;
}

export class MemoryTraceSink implements TraceSink {
  private capacity: number;
  private readonly now: () => number;
  private readonly bootTime: number;
  /** Runs whose workflowId matches are not retained (nor tailed). */
  private exclude: RegExp | null = null;
  private excludeSource: string | null = null;
  /** traceIds currently in flight that matched `exclude` — drop their spans. */
  private readonly excludedTraces = new Set<string>();

  /** traceId → accumulating run. */
  private readonly inProgress = new Map<string, InProgress>();
  /** Finished runs, newest last (ring buffer). */
  private readonly runs: RunDetail[] = [];
  private readonly byRunId = new Map<string, RunDetail>();
  /** Live span subscribers for the tail (filtered by workflow). */
  private readonly subscribers = new Set<{ workflowId?: string; push: (s: SpanData) => void; close: () => void }>();

  constructor(opts: MemoryTraceSinkOptions = {}) {
    this.capacity = opts.capacity ?? 500;
    this.now = opts.now ?? Date.now;
    this.bootTime = this.now();
  }

  // ── Runtime-adjustable config (admin Settings → Observability) ──

  /** Current retention/exclusion, for the settings UI. */
  config(): { capacity: number; exclude: string | null } {
    return { capacity: this.capacity, exclude: this.excludeSource };
  }

  /** Resize the ring buffer (trims oldest immediately). */
  setCapacity(n: number): void {
    this.capacity = Math.max(10, Math.min(10_000, Math.floor(n)));
    while (this.runs.length > this.capacity) {
      const evicted = this.runs.shift();
      if (evicted) this.byRunId.delete(evicted.summary.runId);
    }
  }

  /** Workflow-id exclusion regex (null/"" disables). Throws on a bad pattern.
   *  Matching runs are neither retained nor tailed — e.g. `^admin\\.` silences
   *  the admin's own API traffic. */
  setExclude(pattern: string | null): void {
    if (!pattern) {
      this.exclude = null;
      this.excludeSource = null;
      return;
    }
    this.exclude = new RegExp(pattern); // may throw — caller surfaces it
    this.excludeSource = pattern;
  }

  onRunStart(run: { runId: string; traceId: string; workflowId: string; trigger: string; principal: Principal }): void {
    if (this.exclude?.test(run.workflowId)) {
      this.excludedTraces.add(run.traceId);
      return;
    }
    this.inProgress.set(run.traceId, {
      summary: {
        runId: run.runId,
        traceId: run.traceId,
        workflowId: run.workflowId,
        trigger: run.trigger,
        principal: run.principal,
        status: "running",
        startTime: this.now(),
        spanCount: 0,
      },
      spans: [],
    });
  }

  onSpanEnd(span: SpanData): void {
    if (this.excludedTraces.has(span.traceId)) return;
    const run = this.inProgress.get(span.traceId);
    if (run) {
      run.spans.push(span);
      run.summary.spanCount = run.spans.length;
    }
    // Fan out to live tail subscribers (node spans only — skip the run span).
    if (span.attributes["pattern.node.id"] !== undefined) {
      const wf = run?.summary.workflowId;
      for (const sub of this.subscribers) {
        if (!sub.workflowId || sub.workflowId === wf) sub.push(span);
      }
    }
  }

  onRunEnd(run: { runId: string; traceId: string; status: "ok" | "error"; error?: unknown }): void {
    if (this.excludedTraces.delete(run.traceId)) return;
    const rec = this.inProgress.get(run.traceId);
    if (!rec) return;
    this.inProgress.delete(run.traceId);
    rec.summary.status = run.status;
    rec.summary.endTime = this.now();
    rec.summary.durationMs = rec.summary.endTime - rec.summary.startTime;
    if (run.error !== undefined) {
      rec.summary.error = { message: run.error instanceof Error ? run.error.message : String(run.error) };
    }
    this.runs.push(rec);
    this.byRunId.set(rec.summary.runId, rec);
    while (this.runs.length > this.capacity) {
      const evicted = this.runs.shift();
      if (evicted) this.byRunId.delete(evicted.summary.runId);
    }
  }

  // ── Queries (used by admin.run.* and admin.metrics.summary) ──

  list(filter: { workflow?: string; status?: string; limit?: number } = {}): RunSummary[] {
    const limit = filter.limit ?? 50;
    const out: RunSummary[] = [];
    // Newest first; include in-flight runs at the top.
    const live = [...this.inProgress.values()].map((r) => r.summary);
    for (const s of [...live, ...this.runs.map((r) => r.summary).reverse()]) {
      if (filter.workflow && s.workflowId !== filter.workflow) continue;
      if (filter.status && s.status !== filter.status) continue;
      out.push(s);
      if (out.length >= limit) break;
    }
    return out;
  }

  get(runId: string): RunDetail | null {
    const rec = this.byRunId.get(runId);
    if (rec) return rec;
    for (const r of this.inProgress.values()) if (r.summary.runId === runId) return r;
    return null;
  }

  /** A live stream of node spans, optionally filtered to one workflow (SSE tail). */
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

  metrics(window?: { minutes?: number }): MetricsSummary {
    const minutes = window?.minutes;
    const since = minutes ? this.now() - minutes * 60_000 : this.bootTime;
    const inWindow = this.runs.filter((r) => r.summary.startTime >= since);

    const durations = new Map<string, number[]>();
    const errors = new Map<string, number>();
    let totalErrors = 0;
    for (const r of inWindow) {
      const s = r.summary;
      if (s.durationMs != null) {
        const list = durations.get(s.workflowId) ?? [];
        list.push(s.durationMs);
        durations.set(s.workflowId, list);
      }
      if (s.status === "error") {
        errors.set(s.workflowId, (errors.get(s.workflowId) ?? 0) + 1);
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

    const elapsedMin = Math.max((this.now() - since) / 60_000, 1 / 60);
    return {
      window: minutes ? { label: `last ${minutes}m`, sinceBoot: false, minutes } : { label: "since boot", sinceBoot: true },
      runs: inWindow.length,
      errors: totalErrors,
      errorRate: inWindow.length ? totalErrors / inWindow.length : 0,
      inFlight: this.inProgress.size,
      runsPerMin: inWindow.length / elapsedMin,
      perWorkflow,
    };
  }
}
