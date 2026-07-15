/**
 * The generalized trigger seam (0.4.0): any op can declare
 *  - `outgateOptional` — the validator stops demanding a reachable out-gate
 *    (fire-and-forget callers never read the result), and
 *  - `triggerEvents(config)` — the engine subscribes the node to engine events
 *    at registration and starts a run from it on each emit.
 * boundary.event is now just the simplest consumer of both.
 */

import { describe, it, expect } from "vitest";
import { Engine, collectIssues, defineOp, value, type OpDefinition, type Workflow } from "@pattern-js/core";

/** A mod-style trigger: fires on `inbox.<account>`, maps payload → two ports. */
const inboxTrigger: OpDefinition = defineOp({
  type: "test.inbox",
  description: "Fixture trigger for the generic seam.",
  boundary: "trigger",
  pair: "boundary.return",
  outgateOptional: true,
  triggerEvents: (config: { account?: string }) =>
    config.account
      ? [
          {
            event: `inbox.${config.account}`,
            map: (payload: unknown) => {
              const p = payload as { subject?: string };
              return { subject: p.subject, account: config.account };
            },
          },
        ]
      : [],
  inputs: {},
  outputs: { subject: value(), account: value() },
  execute: () => ({}),
});

const capture = (into: unknown[]): OpDefinition =>
  defineOp({
    type: "test.capture",
    inputs: { value: value() },
    outputs: {},
    execute: async (ctx) => {
      into.push(await ctx.input.value("value"));
      return {};
    },
  });

function subscriberWorkflow(): Workflow {
  return {
    id: "inbox-sub",
    nodes: [
      { id: "in", op: "test.inbox", config: { account: "support" } },
      { id: "grab", op: "test.capture" },
    ],
    edges: [{ from: { node: "in", port: "subject" }, to: { node: "grab", port: "value" } }],
  };
}

describe("triggerEvents (generic event-backed triggers)", () => {
  it("subscribes a mod-defined trigger op and maps the payload into its ports", async () => {
    const engine = new Engine();
    const seen: unknown[] = [];
    engine.registerOp(inboxTrigger).registerOp(capture(seen));
    engine.registerWorkflow(subscriberWorkflow());

    engine.emit("inbox.support", { subject: "hello" });
    engine.emit("inbox.billing", { subject: "wrong account" }); // different event → ignored
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(["hello"]);
  });

  it("re-registering tears down old subscriptions (no double fires)", async () => {
    const engine = new Engine();
    const seen: unknown[] = [];
    engine.registerOp(inboxTrigger).registerOp(capture(seen));
    engine.registerWorkflow(subscriberWorkflow());
    engine.registerWorkflow(subscriberWorkflow()); // upsert

    engine.emit("inbox.support", { subject: "once" });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(["once"]);
  });

  it("boundary.event still rides the same seam", async () => {
    const engine = new Engine();
    const seen: unknown[] = [];
    engine.registerOp(capture(seen));
    engine.registerWorkflow({
      id: "evt-sub",
      nodes: [
        { id: "in", op: "boundary.event", config: { event: "user.created" } },
        { id: "grab", op: "test.capture" },
      ],
      edges: [{ from: { node: "in", port: "payload" }, to: { node: "grab", port: "value" } }],
    });
    engine.emit("user.created", { id: "u1" });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([{ id: "u1" }]);
  });
});

describe("outgateOptional (validator out-gate exemption)", () => {
  const opsOf = (engine: Engine) => engine.ops;

  it("a mod trigger with outgateOptional validates without an out-gate", () => {
    const engine = new Engine();
    engine.registerOp(inboxTrigger).registerOp(capture([]));
    const { ok, issues } = collectIssues(subscriberWorkflow(), opsOf(engine));
    expect(issues.filter((i) => i.code === "trigger_no_outgate")).toEqual([]);
    expect(ok).toBe(true);
  });

  it("boundary.ws.close no longer demands an out-gate (the socket is gone)", () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "on-close",
      nodes: [{ id: "in", op: "boundary.ws.close", config: {} }],
      edges: [],
    };
    const { issues } = collectIssues(wf, opsOf(engine));
    expect(issues.filter((i) => i.code === "trigger_no_outgate")).toEqual([]);
  });

  it("boundary.manual still requires a reachable out-gate", () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "manual-dangling",
      nodes: [
        { id: "in", op: "boundary.manual", config: {} },
        { id: "out", op: "boundary.return" },
      ],
      edges: [], // out-gate exists but the trigger never reaches it
    };
    const { issues } = collectIssues(wf, opsOf(engine));
    expect(issues.some((i) => i.code === "trigger_no_outgate")).toBe(true);
  });
});
