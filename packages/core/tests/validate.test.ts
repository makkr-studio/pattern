import { describe, it, expect } from "vitest";
import { Engine, collectIssues, type PatternMod, type Workflow } from "@pattern/core";

function issues(wf: unknown) {
  const engine = new Engine();
  return collectIssues(wf, engine.ops).issues.map((i) => i.code);
}

describe("validation (§6)", () => {
  it("rejects unknown ops", () => {
    const wf = { id: "x", nodes: [{ id: "a", op: "core.nope" }], edges: [] };
    expect(issues(wf)).toContain("unknown_op");
  });

  it("rejects a value→stream kind mismatch", () => {
    const wf: Workflow = {
      id: "km",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["v"] } },
        { id: "acc", op: "core.stream.accumulate" },
        { id: "out", op: "boundary.return" },
      ],
      // value output "t.v" → stream input "acc.in"
      edges: [
        { from: { node: "t", port: "v" }, to: { node: "acc", port: "in" } },
        { from: { node: "acc", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    expect(issues(wf)).toContain("kind_mismatch");
  });

  it("detects cycles", () => {
    const wf: Workflow = {
      id: "cyc",
      nodes: [
        { id: "t", op: "boundary.manual" },
        { id: "a", op: "core.flow.noop" },
        { id: "b", op: "core.flow.noop" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "a", port: "value" }, to: { node: "b", port: "value" } },
        { from: { node: "b", port: "value" }, to: { node: "a", port: "value" } },
      ],
    };
    expect(issues(wf)).toContain("cycle");
  });

  it("flags a schema mismatch (string → number)", () => {
    const wf: Workflow = {
      id: "sm",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["v"] } },
        { id: "s", op: "core.const.string", config: { value: "hi" } },
        { id: "add", op: "core.math.add" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "s", port: "out" }, to: { node: "add", port: "a" } },
        { from: { node: "t", port: "v" }, to: { node: "add", port: "b" } },
        { from: { node: "add", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    expect(issues(wf)).toContain("schema_mismatch");
  });

  it("requires at least one trigger", () => {
    const wf = { id: "nt", nodes: [{ id: "c", op: "core.const.number", config: { value: 1 } }], edges: [] };
    expect(issues(wf)).toContain("no_trigger");
  });
});

describe("mods (§13)", () => {
  it("installs ops, hooks, and workflows via engine.use", async () => {
    const mod: PatternMod = {
      name: "test-mod",
      ops: [
        {
          type: "mod.shout",
          inputs: { value: { kind: "value" } },
          outputs: { out: { kind: "value" } },
          execute: async (ctx) => ({ out: String(await ctx.input.value("value")).toUpperCase() + "!" }),
        },
      ],
      hooks: [{ name: "mod.hook" }],
    };
    const engine = new Engine();
    engine.use(mod);
    expect(engine.ops.has("mod.shout")).toBe(true);
    expect(engine.hooks.definition("mod.hook")).toBeDefined();

    const wf: Workflow = {
      id: "uses-mod",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: ["v"] } },
        { id: "s", op: "mod.shout" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "v" }, to: { node: "s", port: "value" } },
        { from: { node: "s", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(wf);
    const res = await engine.run(wf, { input: { v: "hey" } });
    expect(Object.values(res.outputs)[0]).toEqual({ value: "HEY!" });
  });
});
