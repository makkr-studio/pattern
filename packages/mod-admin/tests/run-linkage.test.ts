import { describe, it, expect } from "vitest";
import { Engine, type Workflow } from "@pattern/core";
import { MemoryTraceSink } from "../src/index.js";

/**
 * What the Runs page renders for invoked workflows: the child run's summary
 * carries `parent` (the "invoked by" link), `children(runId)` finds the
 * sub-runs (the Sub-runs list), and the invoking node's span carries an
 * `invoke` event (the per-node ↳ link in the waterfall).
 */

const child: Workflow = {
  id: "linked-child",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["item"] } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [{ from: { node: "in", port: "item" }, to: { node: "out", port: "value" } }],
};

const parent: Workflow = {
  id: "linked-parent",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["items"] } },
    { id: "each", op: "core.array.map", config: { workflow: { workflowId: "linked-child" } } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in", port: "items" }, to: { node: "each", port: "values" } },
    { from: { node: "each", port: "out" }, to: { node: "out", port: "value" } },
  ],
};

describe("run linkage in the memory sink", () => {
  it("retains parent refs, finds children, and the invoking span links forward", async () => {
    const engine = new Engine();
    const sink = new MemoryTraceSink();
    engine.onTrace(sink);
    engine.registerWorkflow(child);
    engine.registerWorkflow(parent);

    const res = await engine.run("linked-parent", { input: { items: [1, 2, 3] } });
    expect(res.status).toBe("ok");

    const runs = sink.list({ limit: 10 });
    const parentRun = runs.find((r) => r.workflowId === "linked-parent")!;
    const childRuns = runs.filter((r) => r.workflowId === "linked-child");
    expect(childRuns).toHaveLength(3);
    // Upward: every sub-run knows the run + node that invoked it.
    for (const c of childRuns) {
      expect(c.parent).toEqual({ runId: parentRun.runId, workflowId: "linked-parent", nodeId: "each" });
    }
    // Downward: children() mirrors it (the run-detail Sub-runs list).
    const kids = sink.children(parentRun.runId);
    expect(kids.map((k) => k.runId).sort()).toEqual(childRuns.map((c) => c.runId).sort());
    expect(sink.children(childRuns[0]!.runId)).toEqual([]);

    // And the map node's span carries one `invoke` event per sub-run.
    const detail = sink.get(parentRun.runId)!;
    const mapSpan = detail.spans.find((s) => s.attributes["pattern.node.id"] === "each")!;
    const invokes = mapSpan.events.filter((e) => e.name === "invoke");
    expect(invokes).toHaveLength(3);
    expect(new Set(invokes.map((e) => e.attributes?.runId))).toEqual(new Set(childRuns.map((c) => c.runId)));
  });

  it("sub-runs inherit I/O sampling from the engine default", async () => {
    const engine = new Engine();
    const sink = new MemoryTraceSink();
    engine.onTrace(sink);
    engine.registerWorkflow(child);
    engine.registerWorkflow(parent);
    engine.setIoSampling(true);

    await engine.run("linked-parent", { input: { items: ["a"] } });
    const childRun = sink.list({ workflow: "linked-child" })[0]!;
    const spans = sink.get(childRun.runId)!.spans;
    // The child's out-gate sampled its captured payload.
    const sampled = spans.filter((s) => s.io !== undefined);
    expect(sampled.length).toBeGreaterThan(0);
  });
});
