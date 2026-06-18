import { describe, it, expect } from "vitest";
import { Engine, type SpanData, type Workflow } from "../src/index.js";

/**
 * The trace decouples **result-ready** (out-gates captured → RunResult resolves)
 * from the **true end** (every node span ended — incl. a streaming producer that
 * drains afterward). onRunReady fires at result-ready; onRunEnd fires at the true
 * end. RunResult settlement itself is unchanged.
 *
 * We model "a tail that finishes after result-ready" with a slow parallel node
 * gated on a promise the test releases — same scheduler path a draining stream
 * producer takes (its nodeDone stays pending past result-ready).
 */

interface Captured {
  ready: Array<{ runId: string; at: number; status: string }>;
  end: Array<{ runId: string; at?: number; status: string; endedBy?: string }>;
  spans: SpanData[];
}

function capture(engine: Engine): Captured {
  const c: Captured = { ready: [], end: [], spans: [] };
  engine.onTrace({
    onRunReady: (r) => c.ready.push({ runId: r.runId, at: r.at, status: r.status }),
    onRunEnd: (r) => c.end.push({ runId: r.runId, at: r.at, status: r.status, endedBy: r.endedBy }),
    onSpanEnd: (s) => c.spans.push(s),
  });
  return c;
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("streaming trace: result-ready vs true-end", () => {
  it("non-streaming run fires ready and end together (synchronously)", async () => {
    const engine = new Engine();
    const c = capture(engine);
    const wf: Workflow = {
      id: "plain",
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
    // Both fired by the time the result resolved; end is "drain".
    expect(c.ready).toHaveLength(1);
    expect(c.end).toHaveLength(1);
    expect(c.end[0]!.status).toBe("ok");
    expect(c.end[0]!.endedBy).toBe("drain");
  });

  it("a tail node settling after result-ready defers onRunEnd; durationMs > readyMs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const engine = new Engine();
    engine.registerOp({
      type: "test.slow",
      inputs: { in: { kind: "value" } },
      outputs: { out: { kind: "value" } },
      execute: async () => {
        await gate;
        return { out: 1 };
      },
    });
    const c = capture(engine);
    const wf: Workflow = {
      id: "tail",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
        { id: "out", op: "boundary.return" }, // out-gate → result-ready immediately
        { id: "slow", op: "test.slow" }, // parallel tail, gated
      ],
      edges: [
        { from: { node: "in", port: "v" }, to: { node: "out", port: "value" } },
        { from: { node: "in", port: "v" }, to: { node: "slow", port: "in" } },
      ],
    };
    engine.registerWorkflow(wf);
    const res = await engine.run(wf, { input: { v: 7 } });
    expect(res.status).toBe("ok"); // RunResult resolved at result-ready

    // Ready has fired; the true end has NOT (the tail is still gated).
    expect(c.ready).toHaveLength(1);
    expect(c.end).toHaveLength(0);
    const readyAt = c.ready[0]!.at;

    await new Promise((r) => setTimeout(r, 20)); // let real time pass
    release(); // tail completes → drain → onRunEnd
    await tick();

    expect(c.end).toHaveLength(1);
    expect(c.end[0]!.endedBy).toBe("drain");
    expect(c.end[0]!.at!).toBeGreaterThan(readyAt); // true end is later than ready
    // The tail node's span was captured (it ends after result-ready).
    expect(c.spans.some((s) => s.attributes["pattern.node.id"] === "slow")).toBe(true);
  });

  it("the TTL backstop finalizes a run whose tail never settles", async () => {
    let release!: () => void;
    const forever = new Promise<void>((r) => (release = r)); // released only in cleanup
    const engine = new Engine({ streamDrainTtlMs: 40 });
    engine.registerOp({
      type: "test.forever",
      inputs: { in: { kind: "value" } },
      outputs: { out: { kind: "value" } },
      execute: async () => {
        await forever;
        return { out: 1 };
      },
    });
    const c = capture(engine);
    const wf: Workflow = {
      id: "ttl",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
        { id: "out", op: "boundary.return" },
        { id: "stuck", op: "test.forever" },
      ],
      edges: [
        { from: { node: "in", port: "v" }, to: { node: "out", port: "value" } },
        { from: { node: "in", port: "v" }, to: { node: "stuck", port: "in" } },
      ],
    };
    engine.registerWorkflow(wf);
    await engine.run(wf, { input: { v: 1 } });
    expect(c.end).toHaveLength(0); // still draining

    await new Promise((r) => setTimeout(r, 80)); // past the 40ms TTL
    expect(c.end).toHaveLength(1);
    expect(c.end[0]!.endedBy).toBe("timeout");
    release(); // cleanup the dangling node
  });
});
