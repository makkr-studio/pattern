import { describe, it, expect } from "vitest";
import { Engine, now, type SpanData, type Workflow } from "../src/index.js";

/**
 * The trace clock is high-resolution epoch ms (performance.timeOrigin +
 * performance.now()) — same "epoch ms" meaning as Date.now() but sub-ms float
 * and monotonic, so a fast node no longer rounds to 0.
 */
describe("high-resolution trace clock", () => {
  it("now() is epoch-aligned, monotonic, and sub-ms precise", () => {
    const a = now();
    expect(Math.abs(a - Date.now())).toBeLessThan(50); // same epoch as Date.now()
    const b = now();
    expect(b).toBeGreaterThanOrEqual(a); // monotonic within a process
    // High-res: across a handful of samples at least one is fractional.
    const samples = Array.from({ length: 8 }, () => now());
    expect(samples.some((t) => !Number.isInteger(t))).toBe(true);
  });

  it("span times are stamped with the high-res clock (fractional, sub-ms durations)", async () => {
    const spans: SpanData[] = [];
    const engine = new Engine();
    engine.onTrace({ onSpanEnd: (s) => spans.push(s) });
    const wf: Workflow = {
      id: "fast",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["a", "b"] } },
        { id: "sum", op: "core.math.add" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "a" }, to: { node: "sum", port: "a" } },
        { from: { node: "in", port: "b" }, to: { node: "sum", port: "b" } },
        { from: { node: "sum", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(wf);
    await engine.run(wf, { input: { a: 1, b: 2 } });

    expect(spans.length).toBeGreaterThan(0);
    // Times are epoch ms and fractional (the old Date.now() was integer-only).
    expect(spans.some((s) => !Number.isInteger(s.startTime) || !Number.isInteger(s.endTime))).toBe(true);
    for (const s of spans) {
      expect(s.endTime).toBeGreaterThanOrEqual(s.startTime); // no negative durations
      expect(Math.abs(s.startTime - Date.now())).toBeLessThan(60_000);
    }
  });
});
