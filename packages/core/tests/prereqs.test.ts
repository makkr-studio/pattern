/**
 * Engine prerequisites for `@pattern/mod-admin` (admin-spec §2): P2/P3/P4, T1/T2/T3.
 * P1 (boundary.http.app) and the runtime-node side are covered in runtime-node.
 */

import { describe, it, expect } from "vitest";
import {
  Engine,
  collectIssues,
  formatGraph,
  portCompatibility,
  redactConfig,
  secret,
  value,
  stream,
  z,
  type OpDefinition,
  type PatternMod,
  type SpanData,
  type Workflow,
} from "@pattern/core";

// ── T3: document fields ──

describe("T3 — document fields (description, tags, source, node ui)", () => {
  const wf: Workflow = {
    id: "doc-fields",
    name: "Documented",
    description: "A workflow that carries prose + canvas positions.",
    tags: ["demo", "admin"],
    source: "file",
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["a"] }, ui: { x: 10, y: 20 } },
      { id: "out", op: "boundary.return", ui: { x: 300, y: 20, color: "neon" } },
    ],
    edges: [{ from: { node: "in", port: "a" }, to: { node: "out", port: "value" } }],
  };

  it("validates and preserves the data-only fields through registration", async () => {
    const engine = new Engine();
    expect(collectIssues(wf, engine.ops).ok).toBe(true);
    engine.registerWorkflow(wf);
    const stored = engine.workflows.get("doc-fields")!;
    expect(stored.description).toContain("prose");
    expect(stored.tags).toEqual(["demo", "admin"]);
    expect(stored.source).toBe("file");
    expect(stored.nodes[0]!.ui).toEqual({ x: 10, y: 20 });
    expect(stored.nodes[1]!.ui).toMatchObject({ x: 300, y: 20, color: "neon" });
  });

  it("never lets ui/description affect execution", async () => {
    const engine = new Engine();
    engine.registerWorkflow(wf);
    const res = await engine.run(wf, { input: { a: 42 } });
    expect(Object.values(res.outputs)[0]).toEqual({ value: 42 });
  });
});

// ── P2: frontend contribution + aggregation ──

describe("P2 — frontend contribution aggregation", () => {
  const a: PatternMod = {
    name: "mod-a",
    frontend: {
      assets: "a-assets",
      menu: [{ category: "Tools", label: "Beta", path: "/a/b", order: 20 }],
      pages: [{ path: "/a/b", view: { kind: "json", source: "a.data" } }],
      commands: [{ id: "a.run", label: "Run A" }],
    },
  };
  const b: PatternMod = {
    name: "mod-b",
    frontend: {
      menu: [
        { category: "Tools", label: "Alpha", path: "/b/a", order: 10 },
        { category: "Observability", label: "Metrics", path: "/b/m" },
      ],
    },
  };

  it("aggregates menu/pages/commands across mods, sorted by order then label", () => {
    const engine = new Engine();
    engine.use(a).use(b);
    const fe = engine.frontend();
    expect(fe.menu!.map((m) => m.label)).toEqual(["Alpha", "Beta", "Metrics"]);
    expect(fe.assets).toEqual([{ mod: "mod-a", assets: "a-assets" }]);
    expect(fe.pages).toHaveLength(1);
    expect(fe.commands!.map((c) => c.id)).toEqual(["a.run"]);
  });

  it("records installed mods with their op/workflow contributions", () => {
    const engine = new Engine();
    engine.use({
      name: "mod-ops",
      ops: [{ type: "x.noop", inputs: {}, outputs: {}, execute: async () => ({}) }],
    });
    const installed = engine.installedMods();
    const mod = installed.find((m) => m.name === "mod-ops")!;
    expect(mod.opTypes).toContain("x.noop");
  });
});

// ── P3: useAsync installs a config-port mod ──

describe("P3 — useAsync runs the resolve phase for a config-port mod", () => {
  const configPortWorkflow: Workflow = {
    id: "cfg-port",
    nodes: [
      { id: "port", op: "core.const.number", config: { value: 8123 } },
      { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/x" } },
      { id: "body", op: "core.const.string", config: { value: "ok" } },
      { id: "out", op: "boundary.http.response" },
    ],
    edges: [
      { from: { node: "port", port: "out" }, to: { node: "in", port: "port" } },
      { from: { node: "in", port: "out" }, to: { node: "out", port: "in" } },
      { from: { node: "body", port: "out" }, to: { node: "out", port: "body" } },
    ],
  };

  it("use() throws (sync) but useAsync() resolves config ports", async () => {
    const sync = new Engine();
    expect(() => sync.use({ name: "m", workflows: [configPortWorkflow] })).toThrow(/config ports/i);

    const engine = new Engine();
    await engine.useAsync({ name: "m", workflows: [configPortWorkflow] });
    const stored = engine.workflows.get("cfg-port")!;
    const inNode = stored.nodes.find((n) => n.id === "in")!;
    expect((inNode.config as { port: number }).port).toBe(8123);
    // The config edge was consumed and dropped.
    expect(stored.edges.some((e) => e.to.node === "in" && e.to.port === "port")).toBe(false);
  });
});

// ── P1-adjacent: extensible services seam ──

describe("services seam — provideService / ctx.services.<name>", () => {
  it("exposes a registered service to ops via ctx.services", async () => {
    const engine = new Engine();
    engine.provideService("calc", { add: (x: number, y: number) => x + y });
    engine.registerOp({
      type: "test.use-service",
      inputs: {},
      outputs: { out: value(z.number()) },
      execute: async (ctx) => {
        const calc = ctx.services.calc as { add(a: number, b: number): number };
        return { out: calc.add(2, 3) };
      },
    });
    const wf: Workflow = {
      id: "svc",
      nodes: [
        { id: "t", op: "boundary.manual" },
        { id: "c", op: "test.use-service" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "out" }, to: { node: "c", port: "in" } },
        { from: { node: "c", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(wf);
    const res = await engine.run(wf);
    expect(Object.values(res.outputs)[0]).toEqual({ value: 5 });
  });

  it("refuses to shadow a core capability", () => {
    const engine = new Engine();
    expect(() => engine.provideService("events", {})).toThrow(/reserved/);
  });
});

// ── P4: secret + redactConfig ──

describe("P4 — secret-safe config", () => {
  it("redactConfig masks schema-tagged + env-path fields", () => {
    const schema = z.object({ token: secret(), name: z.string() });
    expect(redactConfig({ token: "t0p", name: "ok" }, schema)).toEqual({ token: "••••", name: "ok" });
    expect(redactConfig({ a: { b: "x" } }, undefined, ["a.b"])).toEqual({ a: { b: "••••" } });
  });

  it("engine.redactedConfig masks env-derived config", () => {
    const engine = new Engine({ env: { API_TOKEN: "supersecret" } });
    engine.registerOp({
      type: "test.secretful",
      inputs: {},
      outputs: { out: value() },
      config: z.object({ token: z.string(), retries: z.number().default(1) }),
      execute: async (ctx) => ({ out: (ctx.config as any).token }),
    });
    const wf: Workflow = {
      id: "sec",
      nodes: [
        { id: "t", op: "boundary.manual" },
        { id: "s", op: "test.secretful", config: { token: { $env: "API_TOKEN" }, retries: 3 } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "out" }, to: { node: "s", port: "in" } },
        { from: { node: "s", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(wf);
    const redacted = engine.redactedConfig("sec", "s") as { token: string; retries: number };
    expect(redacted.token).toBe("••••");
    expect(redacted.retries).toBe(3);
  });

  it("formatGraph masks schema-tagged secrets", () => {
    const engine = new Engine();
    engine.registerOp({
      type: "test.creds",
      inputs: {},
      outputs: { out: value() },
      config: z.object({ apiKey: secret() }),
      execute: async () => ({ out: 1 }),
    });
    const wf: Workflow = {
      id: "g",
      nodes: [
        { id: "t", op: "boundary.manual" },
        { id: "c", op: "test.creds", config: { apiKey: "leakme" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "out" }, to: { node: "c", port: "in" } },
        { from: { node: "c", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };
    const text = formatGraph(wf, engine.ops);
    expect(text).not.toContain("leakme");
    expect(text).toContain("••••");
  });
});

// ── T2: port compatibility ──

describe("T2 — portCompatibility", () => {
  it("accepts same-kind compatible ports", () => {
    expect(portCompatibility(value(z.string()), value(z.string())).ok).toBe(true);
    expect(portCompatibility(stream(), stream()).ok).toBe(true);
  });
  it("suggests accumulate/emit adapters across kinds", () => {
    expect(portCompatibility(stream(), value())).toMatchObject({ ok: false, fix: "accumulate" });
    expect(portCompatibility(value(), stream())).toMatchObject({ ok: false, fix: "emit" });
  });
  it("flags schema mismatch", () => {
    expect(portCompatibility(value(z.string()), value(z.number())).ok).toBe(false);
  });
});

// ── T1: trace I/O sampling ──

describe("T1 — opt-in trace I/O sampling", () => {
  const wf: Workflow = {
    id: "sample",
    nodes: [
      { id: "t", op: "boundary.manual", config: { outputs: ["a", "b"] } },
      { id: "add", op: "core.math.add" },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "t", port: "a" }, to: { node: "add", port: "a" } },
      { from: { node: "t", port: "b" }, to: { node: "add", port: "b" } },
      { from: { node: "add", port: "out" }, to: { node: "out", port: "value" } },
    ],
  };

  it("captures inputs/outputs only when sampleIo is set", async () => {
    const engine = new Engine();
    engine.registerWorkflow(wf);

    const off: SpanData[] = [];
    const unsubA = engine.onTrace({ onSpanEnd: (s) => off.push(s) });
    await engine.run(wf, { input: { a: 2, b: 3 } });
    unsubA();
    expect(off.every((s) => s.io === undefined)).toBe(true);

    const on: SpanData[] = [];
    const unsubB = engine.onTrace({ onSpanEnd: (s) => on.push(s) });
    await engine.run(wf, { input: { a: 2, b: 3 }, sampleIo: true });
    unsubB();
    const addSpan = on.find((s) => s.attributes["pattern.node.id"] === "add")!;
    expect(addSpan.io?.outputs?.out).toMatchObject({ kind: "value", preview: 5 });
    const outSpan = on.find((s) => s.attributes["pattern.node.id"] === "out")!;
    expect(outSpan.io?.outputs?.value).toMatchObject({ kind: "value", preview: 5 });
  });

  it("masks known secret values (schema-tagged + $env) out of sampled I/O", async () => {
    // An op whose secret config value leaks into its runtime output — the
    // sampler must mask it even though it appears in *data*, not config.
    const leaky: OpDefinition = {
      type: "test.leaky",
      config: z.object({ token: secret(), greeting: z.string().default("hi") }),
      inputs: {},
      outputs: { out: value(z.string()) },
      execute: (ctx) => {
        const cfg = ctx.config as { token: string };
        return { out: `Bearer ${cfg.token}` };
      },
    };
    const wf: Workflow = {
      id: "leaky-run",
      nodes: [
        { id: "t", op: "boundary.manual", config: { outputs: [] } },
        { id: "s", op: "test.leaky", config: { token: { $env: "API_TOKEN_X" } } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "t", port: "out" }, to: { node: "s", port: "in" } },
        { from: { node: "s", port: "out" }, to: { node: "out", port: "value" } },
      ],
    };

    const engine = new Engine({ env: { API_TOKEN_X: "sk-supersecret-123" } });
    engine.registerOp(leaky);
    engine.registerWorkflow(wf);

    const spans: SpanData[] = [];
    engine.onTrace({ onSpanEnd: (s) => spans.push(s) });
    // Run by id: the registered workflow has its `$env` refs resolved (the raw
    // doc would fail validation — `token` is an object before resolution).
    await engine.run("leaky-run", { sampleIo: true });

    const sSpan = spans.find((s) => s.attributes["pattern.node.id"] === "s")!;
    const preview = JSON.stringify(sSpan.io?.outputs?.out ?? {});
    expect(preview).not.toContain("sk-supersecret-123");
    expect(preview).toContain("••••");
    // The downstream out-gate's *input* sample is masked too.
    const outSpan = spans.find((s) => s.attributes["pattern.node.id"] === "out")!;
    expect(JSON.stringify(outSpan.io ?? {})).not.toContain("sk-supersecret-123");
  });
});
