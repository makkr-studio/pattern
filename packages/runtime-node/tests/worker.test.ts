import { describe, it, expect, afterAll } from "vitest";
import { Engine, collectStream, type Workflow } from "@pattern-js/core";
import { WorkerPoolTransport } from "@pattern-js/runtime-node";

// The worker loads the BUILT entry (dist/worker/entry.js) and resolves @pattern-js/core
// from node_modules, so both packages must be built before running these tests.
const transport = new WorkerPoolTransport({ size: 1 });
const engine = new Engine({ transport });

afterAll(async () => {
  await engine.close();
});

describe("WorkerPoolTransport", () => {
  it("runs a value workflow on a worker thread", async () => {
    const wf: Workflow = {
      id: "w-add",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["a", "b"] } },
        { id: "sum", op: "core.math.add" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "a" }, to: { node: "sum", port: "a" } },
        { from: { node: "t", port: "b" }, to: { node: "sum", port: "b" } },
        { from: { node: "sum", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(wf);
    const res = await engine.run(wf, { input: { a: 20, b: 22 } });
    expect(res.status).toBe("ok");
    expect(Object.values(res.outputs)[0]).toEqual({ value: 42 });
  });

  it("reconstructs a streamed out-gate result across the worker seam", async () => {
    const wf: Workflow = {
      id: "w-stream",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["items"] } },
        { id: "emit", op: "core.stream.emit" },
        { id: "out", op: "boundary.http.response", config: { mode: "sse" } },
      ],
      edges: [
        { from: { node: "t", port: "items" }, to: { node: "emit", port: "in" } },
        { from: { node: "emit", port: "out" }, to: { node: "out", port: "stream" } },
      ],
    };
    engine.registerWorkflow(wf);
    const res = await engine.run(wf, { input: { items: ["a", "b", "c"] } });
    expect(res.status).toBe("ok");
    const payload = Object.values(res.outputs)[0] as { stream: ReadableStream<unknown> };
    expect(payload.stream).toBeInstanceOf(ReadableStream);
    expect(await collectStream(payload.stream)).toEqual(["a", "b", "c"]);
  });

  it("passes sampleIo across the worker seam (run records I/O samples)", async () => {
    const wf: Workflow = {
      id: "w-sample",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["a", "b"] } },
        { id: "sum", op: "core.math.add" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "a" }, to: { node: "sum", port: "a" } },
        { from: { node: "t", port: "b" }, to: { node: "sum", port: "b" } },
        { from: { node: "sum", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(wf);
    // The worker runs in its own engine, so the host trace sink can't observe
    // its spans — but the run must succeed with the flag set (it used to be
    // silently dropped at the postMessage seam).
    const res = await engine.run(wf, { input: { a: 1, b: 2 }, sampleIo: true });
    expect(res.status).toBe("ok");
    expect(Object.values(res.outputs)[0]).toEqual({ value: 3 });
  });

  it("re-registers an updated definition (no stale workflow on re-dispatch)", async () => {
    const make = (k: number): Workflow => ({
      id: "w-upsert",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["x"] } },
        { id: "c", op: "core.const.number", config: { value: k } },
        { id: "sum", op: "core.math.add" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "x" }, to: { node: "sum", port: "a" } },
        { from: { node: "c", port: "out" }, to: { node: "sum", port: "b" } },
        { from: { node: "sum", port: "out" }, to: { node: "out", port: "value" } },
      ],
    });
    const v1 = make(10);
    engine.registerWorkflow(v1);
    expect(Object.values((await engine.run(v1, { input: { x: 1 } })).outputs)[0]).toEqual({ value: 11 });
    const v2 = make(100);
    engine.updateWorkflow(v2);
    expect(Object.values((await engine.run(v2, { input: { x: 1 } })).outputs)[0]).toEqual({ value: 101 });
  });
});
