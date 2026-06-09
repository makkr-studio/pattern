import { describe, it, expect } from "vitest";
import { Engine, defineOp, required, value, z, type Workflow } from "@pattern/core";

/** Hook listener that appends `label` to payload.order. */
function tagListener(id: string, label: string): Workflow {
  return {
    id,
    nodes: [
      { id: "in", op: "boundary.hook", config: { hook: "h", priority: 10 } },
      { id: "tag", op: "test.tag", config: { label } },
      { id: "out", op: "boundary.hook.return" },
    ],
    edges: [
      { from: { node: "in", port: "payload" }, to: { node: "tag", port: "payload" } },
      { from: { node: "tag", port: "payload" }, to: { node: "out", port: "payload" } },
    ],
  };
}

const tagOp = defineOp({
  type: "test.tag",
  inputs: { payload: required() },
  outputs: { payload: value() },
  config: z.object({ label: z.string() }),
  execute: async (ctx) => {
    const payload = ((await ctx.input.value("payload")) as any) ?? {};
    const label = (ctx.config as any).label;
    return { payload: { ...payload, order: [...(payload.order ?? []), label] } };
  },
});

describe("runtime workflow lifecycle (§ runtime-modifiable)", () => {
  it("upserts a hook listener without leaving stale registrations", async () => {
    const engine = new Engine();
    engine.registerOp(tagOp);

    engine.registerWorkflow(tagListener("L", "a"));
    expect(((await engine.invokeHook("h", { order: [] })) as any).order).toEqual(["a"]);

    // Re-register the SAME id with new behavior — must replace, not stack.
    engine.updateWorkflow(tagListener("L", "b"));
    expect(((await engine.invokeHook("h", { order: [] })) as any).order).toEqual(["b"]);

    // Remove it — the chain is now empty.
    expect(engine.unregisterWorkflow("L")).toBe(true);
    expect(((await engine.invokeHook("h", { order: [] })) as any).order).toEqual([]);
  });

  it("tears down event subscriptions on unregister", async () => {
    const engine = new Engine();
    const seen: unknown[] = [];
    engine.events.subscribe("sink", (p) => seen.push(p));
    const sub: Workflow = {
      id: "S",
      nodes: [
        { id: "in", op: "boundary.event", config: { event: "src" } },
        { id: "fwd", op: "core.event.emit", config: { event: "sink" } },
      ],
      edges: [{ from: { node: "in", port: "payload" }, to: { node: "fwd", port: "payload" } }],
    };
    engine.registerWorkflow(sub);

    engine.emit("src", 1);
    await new Promise((r) => setTimeout(r, 15));
    expect(seen).toEqual([1]);

    engine.unregisterWorkflow("S");
    engine.emit("src", 2);
    await new Promise((r) => setTimeout(r, 15));
    expect(seen).toEqual([1]); // no longer subscribed
  });

  it("notifies subscribers on set/delete", async () => {
    const engine = new Engine();
    const changes: string[] = [];
    engine.onWorkflowsChanged((c) => changes.push(`${c.type}:${c.id}`));
    const wf: Workflow = {
      id: "W",
      nodes: [
        { id: "t", op: "boundary.manual" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [{ from: { node: "t", port: "out" }, to: { node: "out", port: "in" } }],
    };
    engine.registerWorkflow(wf);
    engine.unregisterWorkflow("W");
    expect(changes).toEqual(["set:W", "delete:W"]);
  });
});
