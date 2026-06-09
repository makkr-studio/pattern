import { describe, it, expect, afterAll } from "vitest";
import { Engine, collectStream, type Workflow } from "@pattern/core";
import { WorkerPoolTransport } from "@pattern/runtime-node";

// The worker loads the BUILT entry (dist/worker/entry.js) and resolves @pattern/core
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
});
