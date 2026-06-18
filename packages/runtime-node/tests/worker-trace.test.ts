import { describe, it, expect, afterAll } from "vitest";
import { Engine, type SpanData, type Workflow } from "@pattern/core";
import { WorkerPoolTransport } from "@pattern/runtime-node";

/**
 * An offloaded run executes in a worker's own engine, so its trace would
 * normally vanish. The pool forwards the lifecycle back to the host
 * (`engine.ingestTrace`), tagged with the worker that ran it and under the HOST
 * run id — so offloaded runs appear in the Runs view like inline ones.
 *
 * The worker loads the BUILT entry, so both packages must be built first.
 */
const spans: SpanData[] = [];
const runEnds: Array<{ runId: string; status: string; endedBy?: string }> = [];
const engine = new Engine();
engine.onTrace({
  onSpanEnd: (s) => spans.push(s),
  onRunEnd: (r) => runEnds.push({ runId: r.runId, status: r.status, endedBy: r.endedBy }),
});
const pool = new WorkerPoolTransport({ size: 1, onTrace: (e) => engine.ingestTrace(e) });
engine.setOffloadTransport(pool);

afterAll(async () => {
  await engine.close();
});

const offloadAdd: Workflow = {
  id: "w-offload-trace",
  offload: true,
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

describe("worker trace bridge", () => {
  it("forwards an offloaded run's spans to the host, tagged with the worker + host runId", async () => {
    engine.registerWorkflow(offloadAdd);
    const res = await engine.run(offloadAdd, { input: { a: 20, b: 22 }, sampleIo: true });
    expect(res.status).toBe("ok");
    expect(Object.values(res.outputs)[0]).toEqual({ value: 42 });

    // Trace crosses the seam via postMessage — give it a tick to arrive.
    await new Promise((r) => setTimeout(r, 80));

    // The run finalized in the host sink under the host run id.
    expect(runEnds.some((r) => r.runId === res.runId && r.status === "ok")).toBe(true);

    // Node spans arrived, tagged with the worker that ran them.
    const nodeSpans = spans.filter((s) => s.traceId && s.attributes["pattern.node.id"]);
    expect(nodeSpans.length).toBeGreaterThan(0);
    expect(nodeSpans.every((s) => String(s.attributes.executor ?? "").startsWith("worker:"))).toBe(true);

    // sampleIo crossed the seam → the add node carries an I/O sample.
    const sumSpan = nodeSpans.find((s) => s.attributes["pattern.node.id"] === "sum");
    expect(sumSpan?.io).toBeTruthy();
  });
});
