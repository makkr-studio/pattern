import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { threadId as hostThreadId } from "node:worker_threads";
import { loadProject } from "@pattern-js/runtime-node";
import type { Workflow } from "@pattern-js/core";

// `app.whereami` reports its thread. Inline runs share the host thread (whatever
// id that is — vitest runs the test in its own worker, so it's not 0); offloaded
// runs land on a different (pool) thread. We compare against the host thread,
// not 0, so the assertion holds whether or not vitest pools the test file.

// The worker loads the BUILT entry (dist/worker/entry.js) + resolves @pattern-js/core
// and the fixture mod from disk, so both packages must be built before running.
const modPath = fileURLToPath(new URL("./fixtures/project/mods/whereami.mjs", import.meta.url));

/** `app.whereami` returns the thread it ran on (0 = host/main, >0 = worker). */
const whereami = (id: string, offload?: boolean): Workflow => ({
  id,
  ...(offload !== undefined ? { offload } : {}),
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
    { id: "where", op: "app.whereami" },
    { id: "out", op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in", port: "v" }, to: { node: "where", port: "in" } },
    { from: { node: "where", port: "threadId" }, to: { node: "out", port: "value" } },
  ],
});

const threadOf = (res: { outputs: Record<string, Record<string, unknown>> }) =>
  (Object.values(res.outputs)[0] as { value: number }).value;

describe("project worker offload (config.workers)", () => {
  it("routes an offload workflow to the pool, keeps the rest inline; closes the pool", async () => {
    const project = await loadProject({ mods: [modPath], workers: 1 });
    const { engine } = project;
    const { close } = await project.start();

    // The hybrid is visible: inline transport + an offload pool.
    const info = engine.transportInfo();
    expect((info.offload as { kind?: string })?.kind).toBe("worker-pool");

    engine.registerWorkflow(whereami("inline-flow"));
    engine.registerWorkflow(whereami("offloaded-flow", true));

    const inline = await engine.run("inline-flow", { input: { v: 1 } });
    const offloaded = await engine.run("offloaded-flow", { input: { v: 1 } });

    expect(threadOf(inline)).toBe(hostThreadId); // ran on the host thread
    expect(threadOf(offloaded)).not.toBe(hostThreadId); // ran on a pool thread

    await close(); // tears the pool down
  });

  it("with no `workers`, an offload flag degrades to a graceful inline no-op", async () => {
    const { engine } = await loadProject({ mods: [modPath] });
    expect(engine.transportInfo().offload).toBeUndefined();
    engine.registerWorkflow(whereami("offloaded-flow", true));
    const res = await engine.run("offloaded-flow", { input: { v: 1 } });
    expect(threadOf(res)).toBe(hostThreadId); // ran inline despite the flag
  });
});
