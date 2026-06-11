import { describe, it, expect } from "vitest";
import { Engine, type SpanData, type TraceSink, type Workflow } from "../src/index.js";

/**
 * Run linkage for `ctx.invoke` (§10/§11): a sub-run is a first-class run with
 * its own runId/traceId, linked BOTH ways — the child carries `parent` to the
 * sink's onRunStart, and the invoking node's span carries an `invoke` event
 * with the child's runId. Sampling inherits, so an inspectable parent means an
 * inspectable tree.
 */

const child: Workflow = {
  id: "child-double",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["a"] } },
    { id: "b", op: "core.const.number", config: { value: 2 } },
    { id: "mul", op: "core.math.multiply" },
    { id: "out", op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in", port: "a" }, to: { node: "mul", port: "a" } },
    { from: { node: "b", port: "out" }, to: { node: "mul", port: "b" } },
    { from: { node: "mul", port: "out" }, to: { node: "out", port: "value" } },
  ],
};

const parent: Workflow = {
  id: "parent-try",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["input"] } },
    { id: "call", op: "core.flow.try", config: { workflow: { workflowId: "child-double" } } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in", port: "input" }, to: { node: "call", port: "input" } },
    { from: { node: "call", port: "result" }, to: { node: "out", port: "value" } },
  ],
};

function collectingSink() {
  const starts: Array<Parameters<NonNullable<TraceSink["onRunStart"]>>[0]> = [];
  const spans: SpanData[] = [];
  const sink: TraceSink = {
    onRunStart: (r) => starts.push(r),
    onSpanEnd: (s) => spans.push(s),
  };
  return { sink, starts, spans };
}

describe("ctx.invoke run linkage", () => {
  it("links parent and child runs in both directions", async () => {
    const engine = new Engine();
    const { sink, starts, spans } = collectingSink();
    engine.onTrace(sink);
    engine.registerWorkflow(child);
    engine.registerWorkflow(parent);

    const res = await engine.run("parent-try", { input: { input: { a: 21 } } });
    expect(res.status).toBe("ok");

    const parentStart = starts.find((s) => s.workflowId === "parent-try")!;
    const childStart = starts.find((s) => s.workflowId === "child-double")!;
    expect(parentStart.parent).toBeUndefined();
    // Child is a separate run… linked back to the run + node that invoked it.
    expect(childStart.runId).not.toBe(parentStart.runId);
    expect(childStart.traceId).not.toBe(parentStart.traceId);
    expect(childStart.parent).toEqual({
      runId: parentStart.runId,
      workflowId: "parent-try",
      nodeId: "call",
    });

    // …and the invoking node's span points forward at the child's runId.
    const callSpan = spans.find((s) => s.attributes["pattern.node.id"] === "call")!;
    const invokeEvents = callSpan.events.filter((e) => e.name === "invoke");
    expect(invokeEvents).toHaveLength(1);
    expect(invokeEvents[0]!.attributes).toEqual({ workflowId: "child-double", runId: childStart.runId });
  });

  it("sub-runs inherit the parent's I/O sampling", async () => {
    const engine = new Engine();
    const { sink, spans } = collectingSink();
    engine.onTrace(sink);
    engine.registerWorkflow(child);
    engine.registerWorkflow(parent);

    await engine.run("parent-try", { input: { input: { a: 5 } }, sampleIo: true });
    // The CHILD's mul node sampled its ports — the whole tree is inspectable.
    const mulSpan = spans.find((s) => s.attributes["pattern.node.id"] === "mul")!;
    expect(mulSpan.io?.outputs?.out).toMatchObject({ kind: "value", preview: 10 });
  });

  it("hook-chain member runs link back to the invoking run + node too", async () => {
    const engine = new Engine();
    const { sink, starts, spans } = collectingSink();
    engine.onTrace(sink);

    // Two listeners on hook "h" — each member of the chain is its own run.
    const listener = (id: string, priority: number): Workflow => ({
      id,
      nodes: [
        { id: "in", op: "boundary.hook", config: { hook: "h", priority } },
        { id: "out", op: "boundary.hook.return" },
      ],
      edges: [{ from: { node: "in", port: "payload" }, to: { node: "out", port: "payload" } }],
    });
    engine.registerWorkflow(listener("listener-a", 10));
    engine.registerWorkflow(listener("listener-b", 20));
    // The caller: a node that invokes the chain (Benoit's hook-hello shape).
    engine.registerWorkflow({
      id: "caller",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["payload"] } },
        { id: "call", op: "core.hook.invoke", config: { hook: "h" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "payload" }, to: { node: "call", port: "payload" } },
        { from: { node: "call", port: "payload" }, to: { node: "out", port: "value" } },
      ],
    });

    const res = await engine.run("caller", { input: { payload: { n: 1 } }, sampleIo: true });
    expect(res.status).toBe("ok");

    const callerStart = starts.find((s) => s.workflowId === "caller")!;
    const memberStarts = starts.filter((s) => s.workflowId.startsWith("listener-"));
    expect(memberStarts).toHaveLength(2);
    for (const m of memberStarts) {
      expect(m.parent).toEqual({ runId: callerStart.runId, workflowId: "caller", nodeId: "call" });
    }

    // The invoking node's span links forward to both member runs, named by hook.
    const callSpan = spans.find((s) => s.attributes["pattern.node.id"] === "call")!;
    const invokes = callSpan.events.filter((e) => e.name === "invoke");
    expect(invokes.map((e) => e.attributes?.hook)).toEqual(["h", "h"]);
    expect(new Set(invokes.map((e) => e.attributes?.runId))).toEqual(new Set(memberStarts.map((m) => m.runId)));
  });

  it("engine-level default sampling applies when the caller didn't choose", async () => {
    const engine = new Engine();
    const { sink, spans } = collectingSink();
    engine.onTrace(sink);
    engine.registerWorkflow(child);

    expect(engine.ioSampling()).toBe(false);
    engine.setIoSampling(true);
    await engine.run("child-double", { input: { a: 3 } });
    const mulSpan = spans.find((s) => s.attributes["pattern.node.id"] === "mul")!;
    expect(mulSpan.io?.outputs?.out).toMatchObject({ kind: "value", preview: 6 });

    // An explicit opt-out still wins over the default.
    spans.length = 0;
    await engine.run("child-double", { input: { a: 3 }, sampleIo: false });
    const again = spans.find((s) => s.attributes["pattern.node.id"] === "mul")!;
    expect(again.io).toBeUndefined();
  });
});
