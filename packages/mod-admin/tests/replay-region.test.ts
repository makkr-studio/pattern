import { describe, it, expect } from "vitest";
import type { SpanData } from "@pattern-js/admin-sdk";
import { nodeStateAt, spanAt } from "../src/app/lib/replay.js";

/**
 * A per-chunk stream region runs a member once per chunk, so one node id has
 * many spans in the same run. Replay must reduce a node's state over its whole
 * span SET (not collapse to the last one) — that's what makes the region pulse.
 */
function span(start: number, end: number, status: SpanData["status"] = "ok"): SpanData {
  return {
    traceId: "t",
    spanId: `s${start}`,
    name: "n",
    startTime: start,
    endTime: end,
    attributes: { "pattern.node.id": "m", started: undefined },
    status,
    events: [{ name: "started", time: start }],
  };
}

describe("replay: a node with many spans (per-chunk region)", () => {
  // member ran for chunks at [100,110], [200,210], [300,310]
  const spans = [span(100, 110), span(200, 210), span(300, 310)];

  it("is 'running' whenever ANY of its spans straddles the cursor (pulses)", () => {
    expect(nodeStateAt(spans, 105)).toBe("running"); // inside chunk 0
    expect(nodeStateAt(spans, 150)).toBe("ok"); // between chunks 0 and 1 → already ran
    expect(nodeStateAt(spans, 205)).toBe("running"); // inside chunk 1 → pulses again
    expect(nodeStateAt(spans, 305)).toBe("running"); // inside chunk 2
    expect(nodeStateAt(spans, 50)).toBe("pending"); // before any chunk
  });

  it("surfaces an error across the span set", () => {
    expect(nodeStateAt([span(100, 110), span(200, 210, "error")], 250)).toBe("error");
  });

  it("spanAt picks the span active at the cursor (for per-chunk I/O peeks)", () => {
    expect(spanAt(spans, 205)?.spanId).toBe("s200");
    expect(spanAt(spans, 150)?.spanId).toBe("s100"); // latest already-started
  });
});
