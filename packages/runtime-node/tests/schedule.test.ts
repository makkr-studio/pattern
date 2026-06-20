import { describe, it, expect, afterEach } from "vitest";
import { Engine, type Workflow } from "@pattern-js/core";
import { createScheduleHost } from "@pattern-js/runtime-node";

let host: ReturnType<typeof createScheduleHost> | undefined;
afterEach(() => {
  host?.stop();
  host = undefined;
});

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A schedule workflow that emits an event each interval (result discarded). */
const cronWf: Workflow = {
  id: "cron",
  nodes: [
    { id: "t", op: "boundary.schedule", config: { intervalMs: 15 } },
    { id: "e", op: "core.event.emit", config: { event: "tick" } },
  ],
  edges: [{ from: { node: "t", port: "timestamp" }, to: { node: "e", port: "payload" } }],
};

describe("ScheduleHost — runtime deploy (admin scenario)", () => {
  it("starts firing a schedule workflow deployed AFTER the host started, and stops on remove", async () => {
    const engine = new Engine();
    let fired = 0;
    engine.events.subscribe("tick", () => fired++);

    host = createScheduleHost(engine).start(); // watch the engine; nothing scheduled yet
    await tick(40);
    expect(fired).toBe(0); // nothing deployed → nothing fires

    engine.registerWorkflow(cronWf); // "deploy"
    await tick(60);
    expect(fired).toBeGreaterThan(0);

    const atRemoval = fired;
    engine.unregisterWorkflow("cron"); // "undeploy"
    await tick(60);
    // No more firings after removal (allow one in-flight tick of slack).
    expect(fired - atRemoval).toBeLessThanOrEqual(1);
  });

  it("re-reconciles timers when a schedule workflow is updated", async () => {
    const engine = new Engine();
    let fired = 0;
    engine.events.subscribe("tick", () => fired++);
    engine.registerWorkflow(cronWf);
    host = createScheduleHost(engine).start();
    await tick(50);
    expect(fired).toBeGreaterThan(0);

    // Update to a slower interval — old timer is cleared, new one installed.
    engine.updateWorkflow({ ...cronWf, nodes: cronWf.nodes.map((n) => (n.id === "t" ? { ...n, config: { intervalMs: 1000 } } : n)) });
    const afterUpdate = fired;
    await tick(60);
    expect(fired - afterUpdate).toBeLessThanOrEqual(1); // slow interval → ~no new fires
  });
});
