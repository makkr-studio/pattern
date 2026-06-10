import { describe, it, expect } from "vitest";
import { Engine, type Workflow } from "@pattern/core";

/** Two sequential delays — long enough to reach in and poke the run. */
const slow: Workflow = {
  id: "slow",
  nodes: [
    { id: "in", op: "boundary.manual" },
    { id: "d1", op: "core.time.delay", config: { ms: 60 } },
    { id: "d2", op: "core.time.delay", config: { ms: 60 } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in", port: "value" }, to: { node: "d1", port: "value" } },
    { from: { node: "d1", port: "out" }, to: { node: "d2", port: "value" } },
    { from: { node: "d2", port: "out" }, to: { node: "out", port: "value" } },
  ],
};

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("in-flight run control", () => {
  it("cancelRun aborts a run mid-flight", async () => {
    const engine = new Engine();
    engine.registerWorkflow(slow);
    const result = engine.run("slow", { input: { value: 1 } });
    await tick(15);
    const [runId] = engine.inflightRunIds();
    expect(runId).toBeDefined();
    expect(engine.cancelRun(runId!)).toBe(true);
    const res = await result;
    expect(res.status).toBe("error");
    expect(String(res.error)).toContain("cancelled");
    expect(engine.inflightRunIds()).toHaveLength(0);
    // Unknown / settled runs report false.
    expect(engine.cancelRun(runId!)).toBe(false);
  });

  it("pauseRun holds the next node; resumeRun releases it", async () => {
    const engine = new Engine();
    engine.registerWorkflow(slow);
    let settled = false;
    const result = engine.run("slow", { input: { value: 1 } }).finally(() => (settled = true));
    await tick(15); // d1 is mid-delay
    const [runId] = engine.inflightRunIds();
    expect(engine.pauseRun(runId!)).toBe(true);
    expect(engine.runPaused(runId!)).toBe(true);
    // Without the pause the whole run takes ~120ms; at 250ms it must still be
    // held — d1 finished its in-flight delay, d2 never started.
    await tick(250);
    expect(settled).toBe(false);
    expect(engine.resumeRun(runId!)).toBe(true);
    const res = await result;
    expect(res.status).toBe("ok");
  });

  it("cancelling a PAUSED run unwinds instead of hanging at the gate", async () => {
    const engine = new Engine();
    engine.registerWorkflow(slow);
    const result = engine.run("slow", { input: { value: 1 } });
    await tick(15);
    const [runId] = engine.inflightRunIds();
    engine.pauseRun(runId!);
    await tick(100); // d2 held at the gate
    engine.cancelRun(runId!);
    const res = await result;
    expect(res.status).toBe("error");
  });
});
