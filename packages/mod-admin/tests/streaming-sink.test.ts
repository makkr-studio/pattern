import { describe, it, expect } from "vitest";
import { Engine, type Workflow } from "@pattern/core";
import { MemoryTraceSink } from "../src/index.js";

/**
 * A streaming run (one whose tail finishes after result-ready) stays in-progress
 * as "streaming" with a readyMs, then finalizes with a longer durationMs — and
 * the late tail span attaches to the run instead of being dropped (the bug that
 * made chat turns read as a few ms with the producer span missing).
 */
const tick = () => new Promise((r) => setTimeout(r, 5));

describe("memory sink: streaming run dual-duration + late span", () => {
  it("shows readyMs while streaming, then durationMs > readyMs with the tail span attached", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const engine = new Engine();
    engine.registerOp({
      type: "test.slowtail",
      inputs: { in: { kind: "value" } },
      outputs: { out: { kind: "value" } },
      execute: async () => {
        await gate;
        return { out: 1 };
      },
    });
    const sink = new MemoryTraceSink();
    engine.onTrace(sink);
    const wf: Workflow = {
      id: "stream-turn",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
        { id: "out", op: "boundary.return" },
        { id: "tail", op: "test.slowtail" },
      ],
      edges: [
        { from: { node: "in", port: "v" }, to: { node: "out", port: "value" } },
        { from: { node: "in", port: "v" }, to: { node: "tail", port: "in" } },
      ],
    };
    engine.registerWorkflow(wf);
    const res = await engine.run(wf, { input: { v: 1 } });

    // Result-ready: the run is still in-progress as "streaming", with readyMs set.
    const live = sink.get(res.runId)!;
    expect(live.summary.status).toBe("streaming");
    expect(live.summary.readyMs).toBeGreaterThanOrEqual(0);
    expect(live.summary.durationMs).toBeUndefined();
    // It shows up in the runs list as a live (streaming) run.
    expect(sink.list().some((s) => s.runId === res.runId && s.status === "streaming")).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    release();
    await tick();

    // True end: finalized, longer than readyMs, and the tail span is retained.
    const done = sink.get(res.runId)!;
    expect(done.summary.status).toBe("ok");
    expect(done.summary.durationMs!).toBeGreaterThanOrEqual(done.summary.readyMs!);
    expect(done.summary.durationMs! - done.summary.readyMs!).toBeGreaterThan(10);
    expect(done.summary.endedBy).toBe("drain");
    expect(done.spans.some((s) => s.attributes["pattern.node.id"] === "tail")).toBe(true);
  });
});
