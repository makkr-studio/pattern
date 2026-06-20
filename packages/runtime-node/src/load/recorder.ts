/**
 * The flight recorder — a `TraceSink` that turns the engine's per-node spans
 * into load attribution. This is what generic HTTP load tools can't do: while
 * the client measures latency from outside, the recorder watches every node
 * run from inside the same process and, when the window closes, says which ops
 * dominated the time and how deep run concurrency got.
 *
 * Correlation is by TIME WINDOW, not per-request: during a measured stage we
 * aggregate all spans by op type. "p99 latency is mostly store.put" needs the
 * op rollup, not a request→run join — and the window approach is robust to
 * sub-runs, streams, and fan-out that a 1:1 join would mangle.
 */

import type { SpanData, TraceSink } from "@pattern-js/core";
import type { FlightRecording, OpStat } from "./types.js";

/** A node span's op type, or null for the run-root span (no op — skip it so
 *  the rollup is pure per-op work, not "the whole run" double-counting). */
function opOf(span: SpanData): string | null {
  const op = span.attributes?.["pattern.op.type"];
  return typeof op === "string" && op ? op : null;
}

const percentile = (sorted: number[], p: number): number => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
};

export class FlightRecorder implements TraceSink {
  private recording = false;
  private windowStart = 0;
  private spans = 0;
  private runs = 0;
  private runErrors = 0;
  private concurrency = 0;
  private maxConcurrency = 0;
  /** op type → durations (ms) of every span seen this window. */
  private durations = new Map<string, number[]>();
  private errors = new Map<string, number>();

  /** Begin (or restart) a measurement window — clears the prior rollup. */
  start(now: number): void {
    this.recording = true;
    this.windowStart = now;
    this.spans = 0;
    this.runs = 0;
    this.runErrors = 0;
    // Concurrency is a live gauge — DON'T reset it (runs may still be in
    // flight from a warmup); just reset the observed max for this window.
    this.maxConcurrency = this.concurrency;
    this.durations.clear();
    this.errors.clear();
  }

  /** Close the window and roll up. `now` stamps the wall duration. */
  stop(now: number): FlightRecording {
    this.recording = false;
    const ops: OpStat[] = [];
    for (const [op, ds] of this.durations) {
      const sorted = [...ds].sort((a, b) => a - b);
      const total = sorted.reduce((s, d) => s + d, 0);
      ops.push({
        op,
        count: sorted.length,
        totalMs: Math.round(total),
        selfMs: Math.round(total), // self == total for now (no child subtraction)
        p50: Math.round(percentile(sorted, 50) * 100) / 100,
        p99: Math.round(percentile(sorted, 99) * 100) / 100,
        errors: this.errors.get(op) ?? 0,
      });
    }
    ops.sort((a, b) => b.totalMs - a.totalMs);
    return {
      spans: this.spans,
      runs: this.runs,
      runErrors: this.runErrors,
      maxConcurrency: this.maxConcurrency,
      ops,
      windowMs: now - this.windowStart,
    };
  }

  // ── TraceSink ──
  onRunStart(): void {
    this.concurrency += 1;
    if (this.concurrency > this.maxConcurrency) this.maxConcurrency = this.concurrency;
    if (this.recording) this.runs += 1;
  }

  onRunEnd(run: { status: "ok" | "error" }): void {
    this.concurrency = Math.max(0, this.concurrency - 1);
    if (this.recording && run.status === "error") this.runErrors += 1;
  }

  onSpanEnd(span: SpanData): void {
    if (!this.recording) return;
    const op = opOf(span);
    if (op === null) return; // run-root span — counted via onRunStart, not here
    this.spans += 1;
    const dur = span.endTime - span.startTime;
    const arr = this.durations.get(op);
    if (arr) arr.push(dur);
    else this.durations.set(op, [dur]);
    if (span.status === "error") this.errors.set(op, (this.errors.get(op) ?? 0) + 1);
  }
}
