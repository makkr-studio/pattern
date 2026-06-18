import { describe, it, expect } from "vitest";
import { Engine, collectIssues, formatGraph, type PatternMod, type Workflow } from "@pattern/core";

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

describe("privileged-op-without-auth warning (§9)", () => {
  /** Engine with a `privileged`-tagged data op registered. */
  const engineWithPrivileged = () => {
    const engine = new Engine();
    engine.registerOp({
      type: "test.secrets.list",
      inputs: {},
      outputs: { secrets: { kind: "value" } },
      sensitivity: "privileged",
      execute: async () => ({ secrets: [] }),
    });
    return engine;
  };

  const route = (requireAuth?: unknown): Workflow => ({
    id: "secrets-route",
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/secrets", ...(requireAuth !== undefined ? { requireAuth } : {}) } },
      { id: "op", op: "test.secrets.list" },
      { id: "out", op: "boundary.http.response" },
    ],
    edges: [
      { from: { node: "in", port: "out" }, to: { node: "op", port: "in" } },
      { from: { node: "op", port: "secrets" }, to: { node: "out", port: "body" } },
    ],
  });

  it("warns (non-blocking) when a network trigger reaches a privileged op with no requireAuth", () => {
    const res = collectIssues(route(), engineWithPrivileged().ops);
    const warn = res.issues.find((i) => i.code === "privileged_without_auth");
    expect(warn?.severity).toBe("warning");
    expect(warn?.nodeId).toBe("in");
    // A warning does NOT fail validation — the workflow still registers + runs.
    expect(res.ok).toBe(true);
  });

  it("is silent once the trigger declares requireAuth", () => {
    for (const auth of [true, { scopes: ["admin"] }]) {
      const res = collectIssues(route(auth), engineWithPrivileged().ops);
      expect(res.issues.some((i) => i.code === "privileged_without_auth")).toBe(false);
      expect(res.ok).toBe(true);
    }
  });

  it("is silent for an ordinary (untagged) op on an open route", () => {
    const engine = new Engine();
    engine.registerOp({ type: "test.greetings", inputs: {}, outputs: { greetings: { kind: "value" } }, execute: async () => ({ greetings: [] }) });
    const wf = route();
    wf.nodes[1]!.op = "test.greetings";
    wf.edges[1]!.from.port = "greetings";
    expect(collectIssues(wf, engine.ops).issues.some((i) => i.code === "privileged_without_auth")).toBe(false);
  });
});

describe("node comments", () => {
  const wf: Workflow = {
    id: "documented",
    nodes: [
      { id: "t", op: "boundary.manual", config: { outputs: ["a"] }, comment: "entry point — caller passes `a`" },
      { id: "double", op: "core.math.multiply", title: "x2", comment: "multiply by two\n(the educational step)" },
      { id: "two", op: "core.const.number", config: { value: 2 } },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "t", port: "a" }, to: { node: "double", port: "a" } },
      { from: { node: "two", port: "out" }, to: { node: "double", port: "b" } },
      { from: { node: "double", port: "out" }, to: { node: "out", port: "value" } },
    ],
  };

  it("validate accepts comments and they don't affect execution", async () => {
    const engine = new Engine();
    expect(collectIssues(wf, engine.ops).ok).toBe(true);
    engine.registerWorkflow(wf);
    const res = await engine.run(wf, { input: { a: 21 } });
    expect(Object.values(res.outputs)[0]).toEqual({ value: 42 });
    // Comments survive registration (carried as data).
    expect(engine.workflows.get("documented")!.nodes[0]!.comment).toContain("entry point");
  });

  it("renders comments in `pattern graph` output", () => {
    const engine = new Engine();
    const out = formatGraph(wf, engine.ops);
    expect(out).toContain("entry point — caller passes `a`");
    expect(out).toContain("the educational step"); // multi-line comment
    expect(out).toContain("double — x2"); // title shown inline
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
