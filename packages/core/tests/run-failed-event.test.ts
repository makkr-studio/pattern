import { describe, expect, it } from "vitest";
import { Engine, type Workflow } from "@pattern-js/core";

/**
 * The run.failed bridge (0.5 failure alerts): every failed TOP-LEVEL run emits
 * exactly one bus event — sub-run failures fold into their parent, cancels
 * are an operator's choice, and a failing alert workflow can't alert about
 * itself.
 */

interface FailedEvt {
  runId: string;
  workflowId: string;
  trigger: string;
  error: { message: string };
  at: number;
}

const failing = (id: string): Workflow =>
  ({
    id,
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
      { id: "boom", op: "core.flow.assert", config: { message: "deliberate" } },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "in", port: "v" }, to: { node: "boom", port: "condition" } },
      { from: { node: "in", port: "v" }, to: { node: "out", port: "value" } },
    ],
  }) as Workflow;

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

function collect(engine: Engine): FailedEvt[] {
  const events: FailedEvt[] = [];
  engine.events.subscribe("run.failed", (p) => events.push(p as FailedEvt));
  return events;
}

describe("run.failed emission", () => {
  it("a failed run emits exactly once, with the workflow and the error", async () => {
    const engine = new Engine();
    const events = collect(engine);
    engine.registerWorkflow(failing("flaky"));
    const res = await engine.run("flaky", { input: { v: false } });
    expect(res.status).toBe("error");
    await tick();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ runId: res.runId, workflowId: "flaky" });
    expect(events[0]!.error.message).toContain("deliberate");
  });

  it("an ok run emits nothing", async () => {
    const engine = new Engine();
    const events = collect(engine);
    engine.registerWorkflow(failing("fine"));
    const res = await engine.run("fine", { input: { v: true } });
    expect(res.status).toBe("ok");
    await tick();
    expect(events).toHaveLength(0);
  });

  it("a sub-run failure folds into ONE parent event", async () => {
    const engine = new Engine();
    const events = collect(engine);
    engine.registerWorkflow(failing("child"));
    engine.registerWorkflow({
      id: "parent",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["items"] } },
        { id: "each", op: "core.flow.foreach", config: { workflow: { workflowId: "child" } } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "items" }, to: { node: "each", port: "values" } },
        { from: { node: "each", port: "results" }, to: { node: "out", port: "value" } },
      ],
    } as Workflow);
    const res = await engine.run("parent", { input: { items: [false] } });
    expect(res.status).toBe("error");
    await tick();
    expect(events).toHaveLength(1);
    expect(events[0]!.workflowId).toBe("parent");
  });

  it("a cancel is not an incident — no emission", async () => {
    const engine = new Engine();
    const events = collect(engine);
    engine.registerWorkflow({
      id: "slow",
      nodes: [
        { id: "in", op: "boundary.manual" },
        { id: "d", op: "core.time.delay", config: { ms: 500 } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "d", port: "in" } },
        { from: { node: "d", port: "out" }, to: { node: "out", port: "value" } },
      ],
    } as Workflow);
    const result = engine.run("slow", { input: {} });
    await tick(15);
    engine.cancelRun(engine.inflightRunIds()[0]!);
    const res = await result;
    expect(res.status).toBe("canceled");
    await tick();
    expect(events).toHaveLength(0);
  });

  it("a failing run.failed subscriber never re-emits (the recursion guard)", async () => {
    const engine = new Engine();
    const events = collect(engine);
    // The "alert workflow": subscribed to run.failed, and itself broken.
    engine.registerWorkflow({
      id: "broken-alert",
      nodes: [
        { id: "in", op: "boundary.event", config: { event: "run.failed" } },
        { id: "boom", op: "core.flow.throw", config: { message: "alert pipeline down" } },
      ],
      edges: [{ from: { node: "in", port: "payload" }, to: { node: "boom", port: "data" } }],
    } as Workflow);
    engine.registerWorkflow(failing("flaky"));
    const res = await engine.run("flaky", { input: { v: false } });
    expect(res.status).toBe("error");
    await tick(120); // let the broken alert run AND fail
    // One event for the flaky run; the broken alert's own failure stays silent.
    expect(events).toHaveLength(1);
    expect(events[0]!.workflowId).toBe("flaky");
  });
});
