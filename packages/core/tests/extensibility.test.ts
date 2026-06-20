import { describe, it, expect } from "vitest";
import {
  Engine,
  defineOp,
  required,
  value,
  z,
  CollectingTraceSink,
  HookRecursionError,
  type Workflow,
} from "@pattern-js/core";

/** A test op that appends its `label` to `payload.order` and returns the payload. */
const tagOp = defineOp({
  type: "test.tag",
  inputs: { payload: required() },
  outputs: { payload: value() },
  config: z.object({ label: z.string(), stop: z.boolean().default(false) }),
  execute: async (ctx) => {
    const payload = ((await ctx.input.value("payload")) as any) ?? {};
    const { label } = ctx.config as { label: string };
    return { payload: { ...payload, order: [...(payload.order ?? []), label] } };
  },
});

/** Build a hook-listener workflow that tags the payload at a given priority. */
function listener(id: string, hook: string, priority: number, label: string, stop = false): Workflow {
  return {
    id,
    nodes: [
      { id: "in", op: "boundary.hook", config: { hook, priority } },
      { id: "tag", op: "test.tag", config: { label } },
      { id: "stopv", op: "core.const.boolean", config: { value: stop } },
      { id: "out", op: "boundary.hook.return" },
    ],
    edges: [
      { from: { node: "in", port: "payload" }, to: { node: "tag", port: "payload" } },
      { from: { node: "tag", port: "payload" }, to: { node: "out", port: "payload" } },
      { from: { node: "stopv", port: "out" }, to: { node: "out", port: "stop" } },
    ],
  };
}

describe("hooks (§8)", () => {
  it("threads payload through listeners in ascending priority", async () => {
    const engine = new Engine();
    engine.registerOp(tagOp);
    engine.registerWorkflow(listener("l-b", "h", 20, "b"));
    engine.registerWorkflow(listener("l-a", "h", 10, "a"));
    const result = (await engine.invokeHook("h", { order: [] })) as any;
    expect(result.order).toEqual(["a", "b"]);
  });

  it("short-circuits when a listener sets stop: true", async () => {
    const engine = new Engine();
    engine.registerOp(tagOp);
    engine.registerWorkflow(listener("l-a", "h", 10, "a", true));
    engine.registerWorkflow(listener("l-b", "h", 20, "b"));
    const result = (await engine.invokeHook("h", { order: [] })) as any;
    expect(result.order).toEqual(["a"]); // b never runs
  });

  it("fails fast when a listener throws", async () => {
    const engine = new Engine();
    const boom: Workflow = {
      id: "boom",
      nodes: [
        { id: "in", op: "boundary.hook", config: { hook: "h", priority: 5 } },
        { id: "x", op: "core.flow.throw", config: { message: "nope" } },
        { id: "out", op: "boundary.hook.return" },
      ],
      edges: [
        { from: { node: "in", port: "payload" }, to: { node: "x", port: "data" } },
        { from: { node: "in", port: "payload" }, to: { node: "out", port: "payload" } },
        { from: { node: "x", port: "out" }, to: { node: "out", port: "in" } },
      ],
    };
    engine.registerWorkflow(boom);
    await expect(engine.invokeHook("h", {})).rejects.toThrow(/nope/);
  });

  it("validates the payload against the declared schema", async () => {
    const engine = new Engine();
    engine.declareHook({ name: "typed", payload: z.object({ count: z.number() }) });
    await expect(engine.invokeHook("typed", { count: "no" })).rejects.toThrow();
  });

  it("trips the recursion guard", async () => {
    const engine = new Engine();
    engine.declareHook({ name: "rec", maxDepth: 2 });
    const recursive: Workflow = {
      id: "rec-wf",
      nodes: [
        { id: "in", op: "boundary.hook", config: { hook: "rec", priority: 10 } },
        { id: "again", op: "core.hook.invoke", config: { hook: "rec" } },
        { id: "out", op: "boundary.hook.return" },
      ],
      edges: [
        { from: { node: "in", port: "payload" }, to: { node: "again", port: "payload" } },
        { from: { node: "again", port: "payload" }, to: { node: "out", port: "payload" } },
      ],
    };
    engine.registerWorkflow(recursive);
    // The guard throws HookRecursionError deep in the chain; it surfaces wrapped
    // in a NodeExecutionError, whose message preserves the guard text.
    await expect(engine.invokeHook("rec", {})).rejects.toThrow(/maxDepth/);
  });

  it("tracks recursion depth per call chain — concurrency never trips the guard", async () => {
    const engine = new Engine();
    engine.registerOp(tagOp);
    // maxDepth 2 with 8 *parallel* invocations: a shared counter would read
    // depth ≥ 2 and throw spuriously; per-chain tracking must not.
    engine.declareHook({ name: "par", maxDepth: 2 });
    engine.registerWorkflow(listener("l-par", "par", 10, "x"));
    const results = await Promise.all(
      Array.from({ length: 8 }, () => engine.invokeHook("par", { order: [] }) as Promise<{ order: string[] }>),
    );
    for (const r of results) expect(r.order).toEqual(["x"]);
  });
});

describe("events (§8)", () => {
  it("delivers fire-and-forget events to subscribers", async () => {
    const engine = new Engine();
    const seen: unknown[] = [];
    engine.events.subscribe("ping", (p) => seen.push(p));
    engine.emit("ping", { n: 1 });
    engine.emit("ping", { n: 2 });
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("runs a boundary.event subscriber workflow on emit", async () => {
    const engine = new Engine();
    const seen: unknown[] = [];
    engine.events.subscribe("captured", (p) => seen.push(p));
    const sub: Workflow = {
      id: "sub",
      nodes: [
        { id: "in", op: "boundary.event", config: { event: "user.created" } },
        { id: "fwd", op: "core.event.emit", config: { event: "captured" } },
      ],
      edges: [{ from: { node: "in", port: "payload" }, to: { node: "fwd", port: "payload" } }],
    };
    engine.registerWorkflow(sub);
    engine.emit("user.created", { id: "u1" });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([{ id: "u1" }]);
  });
});

describe("observability (§10)", () => {
  it("emits one span per node plus run start/end", async () => {
    const engine = new Engine();
    const sink = new CollectingTraceSink();
    engine.onTrace(sink);
    const wf: Workflow = {
      id: "traced",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["a"] } },
        { id: "neg", op: "core.math.multiply" },
        { id: "k", op: "core.const.number", config: { value: -1 } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "a" }, to: { node: "neg", port: "a" } },
        { from: { node: "k", port: "out" }, to: { node: "neg", port: "b" } },
        { from: { node: "neg", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(wf);
    await engine.run(wf, { input: { a: 5 } });
    expect(sink.runs).toHaveLength(1);
    expect(sink.ended[0]?.status).toBe("ok");
    // spans for neg, k, out (trigger seeds without a span).
    const ops = sink.spans.map((s) => s.attributes["pattern.op.type"]);
    expect(ops).toContain("core.math.multiply");
    expect(ops).toContain("boundary.return");
  });
});
