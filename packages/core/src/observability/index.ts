/**
 * Observability (§10) — OTLP-shaped spans, a fan-out sink, and a couple of
 * ready-made sinks (console, in-memory collector) for dev and tests.
 */

export * from "./span.js";
export { sampleValue, streamSample, SAMPLE_CAP, type MaskFn } from "./sample.js";

import type { SpanData, TraceSink, Principal } from "../types.js";

/** Collects everything into arrays; handy in tests and `pattern graph`. */
export class CollectingTraceSink implements TraceSink {
  readonly runs: Array<{ runId: string; workflowId: string; trigger: string; principal: Principal }> = [];
  readonly spans: SpanData[] = [];
  readonly ended: Array<{ runId: string; status: "ok" | "error"; error?: unknown }> = [];

  onRunStart(run: { runId: string; workflowId: string; trigger: string; principal: Principal }): void {
    this.runs.push(run);
  }
  onSpanEnd(span: SpanData): void {
    this.spans.push(span);
  }
  onRunEnd(run: { runId: string; status: "ok" | "error"; error?: unknown }): void {
    this.ended.push(run);
  }
}

/** Pretty per-node timing to the console; opt-in via `engine.onTrace(consoleTraceSink())`. */
export function consoleTraceSink(
  log: (msg: string) => void = (m) => console.error(m),
): TraceSink {
  return {
    onRunStart(run) {
      log(`▶ run ${run.runId.slice(0, 8)} ${run.workflowId} (${run.trigger})`);
    },
    onSpanEnd(span) {
      const ms = span.endTime - span.startTime;
      const mark = span.status === "error" ? "✗" : "·";
      const node = span.attributes["pattern.node.id"] ?? span.name;
      const op = span.attributes["pattern.op.type"] ?? "";
      log(`  ${mark} ${String(node)} ${op ? `(${op}) ` : ""}${ms}ms`);
    },
    onRunEnd(run) {
      log(`■ run ${run.runId.slice(0, 8)} ${run.status}`);
    },
  };
}
