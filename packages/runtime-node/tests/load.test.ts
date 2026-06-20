import { describe, expect, it } from "vitest";
import { FlightRecorder, summarize, type RequestSample } from "@pattern-js/runtime-node";
import type { SpanData } from "@pattern-js/core";

/** A finished node span for the recorder. */
function span(op: string, ms: number, status: "ok" | "error" = "ok"): SpanData {
  return {
    traceId: "t", spanId: Math.random().toString(36).slice(2), name: `node`,
    startTime: 0, endTime: ms, attributes: { "pattern.op.type": op }, events: [], status,
  };
}

function sample(latencyMs: number, status = 200): RequestSample {
  return { scheduledAt: 0, sentAt: 1, endedAt: latencyMs, status, ok: status >= 200 && status < 400, bytes: 10, label: "GET /x" };
}

describe("flight recorder", () => {
  it("rolls up span time by op, ranks by total, and tracks peak concurrency", () => {
    const r = new FlightRecorder();
    // Two runs overlap → concurrency 2; a third after → still peaks at 2.
    r.onRunStart(); r.onRunStart();
    r.start(0);
    r.onSpanEnd(span("store.put", 40));
    r.onSpanEnd(span("store.put", 60));
    r.onSpanEnd(span("core.string.template", 5));
    r.onSpanEnd(span("agents.run", 8, "error"));
    r.onRunEnd({ status: "error" });
    r.onRunEnd({ status: "ok" });
    const rec = r.stop(100);

    expect(rec.spans).toBe(4);
    expect(rec.maxConcurrency).toBe(2);
    expect(rec.runErrors).toBe(1);
    // store.put dominates total span time → ranked first.
    expect(rec.ops[0]!.op).toBe("store.put");
    expect(rec.ops[0]!.count).toBe(2);
    expect(rec.ops[0]!.totalMs).toBe(100);
    expect(rec.ops.find((o) => o.op === "agents.run")!.errors).toBe(1);
  });

  it("only records spans within an open window", () => {
    const r = new FlightRecorder();
    r.onSpanEnd(span("core.flow.noop", 1)); // before start → ignored
    r.start(0);
    r.onSpanEnd(span("core.flow.noop", 2));
    const rec = r.stop(10);
    expect(rec.spans).toBe(1);
  });
});

describe("stage summary", () => {
  it("computes latency percentiles from scheduled→ended and counts statuses", () => {
    const samples = [sample(10), sample(20), sample(30), sample(40), sample(500, 500)];
    const s = summarize({ rate: 100, durationMs: 1000 }, samples);
    expect(s.requests).toBe(5);
    expect(s.errors).toBe(1);
    expect(s.byStatus["200"]).toBe(4);
    expect(s.byStatus["500"]).toBe(1);
    expect(s.p50).toBeGreaterThanOrEqual(20);
    expect(s.max).toBe(500);
  });
});
