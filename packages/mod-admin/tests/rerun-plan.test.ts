/**
 * mod-admin — the re-run conversation over HTTP: `dryRun` returns the plan
 * (what reuses, executes, stays skipped, and which external-effect nodes are
 * ambiguous) BEFORE anything starts; an unconfirmed resume through an
 * ambiguous node comes back `blocked`, never as a started run.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Engine, MemoryRunLedger, RUN_LEDGER, type Workflow } from "@pattern-js/core";
import { createHttpHost, memoryFs } from "@pattern-js/runtime-node";
import { adminMod } from "@pattern-js/mod-admin";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

const PORT = 4967;
const api = (p: string) => `http://localhost:${PORT}/admin/api${p}`;
const post = (p: string, body: unknown) =>
  fetch(api(p), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

async function boot() {
  // No auth provider in this harness — the admin under test is acknowledged-open.
  const engine = new Engine({ unenforcedAuth: "open" });
  const ledger = new MemoryRunLedger();
  engine.provideService(RUN_LEDGER, ledger);
  await engine.useAsync(adminMod({ storage: memoryFs(), auth: false }));
  let healed = false;
  engine.registerOp({
    type: "t.send",
    effects: "external",
    inputs: { value: { kind: "value", required: true } },
    outputs: { out: { kind: "value" } },
    execute: async (ctx) => ({ out: `sent:${await ctx.input.value("value")}` }),
  });
  engine.registerOp({
    type: "t.shaky",
    effects: "pure",
    inputs: { value: { kind: "value", required: true } },
    outputs: { out: { kind: "value" } },
    execute: async (ctx) => {
      const v = await ctx.input.value("value");
      if (!healed) throw new Error("downstream is down");
      return { out: `ok:${v}` };
    },
  });
  engine.registerWorkflow({
    id: "pay",
    durable: true,
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
      { id: "send", op: "t.send" },
      { id: "shaky", op: "t.shaky" },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "in", port: "v" }, to: { node: "send", port: "value" } },
      { from: { node: "send", port: "out" }, to: { node: "shaky", port: "value" } },
      { from: { node: "shaky", port: "out" }, to: { node: "out", port: "value" } },
    ],
  } as Workflow);
  const { close } = await createHttpHost(engine, { defaultPort: PORT }).start();
  closer = close;
  return { engine, ledger, heal: () => (healed = true) };
}

describe("admin.run.rerun — the plan before the click", () => {
  it("dryRun returns the plan; a blocked resume names the ambiguous node; confirmation proceeds", async () => {
    const { engine, ledger, heal } = await boot();
    const first = await engine.run("pay", { input: { v: "inv-1" } });
    expect(first.status).toBe("error");

    // The plan: send's recorded result is reused, the failed frontier executes.
    const planned = await post(`/runs/${first.runId}/rerun`, { dryRun: true });
    expect(planned.ok).toBe(true);
    expect(planned.runId).toBeUndefined(); // nothing started
    expect(planned.plan).toMatchObject({
      from: "failure",
      reuse: [{ nodeId: "send", op: "t.send" }],
      execute: [
        { nodeId: "shaky", op: "t.shaky", effects: "pure" },
        { nodeId: "out", op: "boundary.return", effects: "pure" },
      ],
      ambiguous: [],
    });

    // From start: everything runs again — the plan says which nodes are external.
    const fresh = await post(`/runs/${first.runId}/rerun`, { dryRun: true, from: "start" });
    expect(fresh.plan.reuse).toEqual([]);
    expect(fresh.plan.execute[0]).toEqual({ nodeId: "send", op: "t.send", effects: "external" });

    // Forge the crash-mid-send shape → the plan flags it, and an unconfirmed
    // resume is a conversation (blocked), not a started run.
    ledger.nodeFinished({ runId: first.runId, nodeId: "send", status: "started" });
    const flagged = await post(`/runs/${first.runId}/rerun`, { dryRun: true });
    expect(flagged.plan.ambiguous).toEqual([{ nodeId: "send", op: "t.send", reason: "started" }]);
    const blocked = await post(`/runs/${first.runId}/rerun`, {});
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toEqual([{ nodeId: "send", op: "t.send", reason: "started" }]);
    expect(blocked.message).toMatch(/never finished/);

    heal();
    const go = await post(`/runs/${first.runId}/rerun`, { confirmExternal: true });
    expect(go.ok).toBe(true);
    expect(typeof go.runId).toBe("string");
    expect(go.runId).not.toBe(first.runId);
  });
});
