import { describe, expect, it, vi } from "vitest";
import { Engine, TriggerInputError, type Workflow } from "@pattern-js/core";
import { agentsMod } from "../src/mod.js";
import { AGENTS_SERVICE, type AgentsService } from "../src/well-known.js";
import { toolsetSchema, turnEventSchema, type ToolsetDescriptor } from "../src/types.js";

/** A weather tool: boundary.tool with a params schema → object out. */
const weatherTool: Workflow = {
  id: "tool-weather",
  nodes: [
    {
      id: "in",
      op: "boundary.tool",
      config: {
        name: "get_weather",
        description: "Current weather for a city",
        params: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
          additionalProperties: false,
        },
      },
    },
    { id: "get", op: "core.object.get", config: { path: "city" } },
    { id: "build", op: "core.object.build", config: { keys: ["city"] } },
    { id: "out", op: "boundary.tool.return" },
  ],
  edges: [
    { from: { node: "in", port: "args" }, to: { node: "get", port: "object" } },
    { from: { node: "get", port: "out" }, to: { node: "build", port: "city" } },
    { from: { node: "build", port: "out" }, to: { node: "out", port: "result" } },
  ],
};

async function boot() {
  const engine = new Engine();
  await engine.useAsync(agentsMod());
  return { engine, svc: engine.service<AgentsService>(AGENTS_SERVICE)! };
}

describe("tool registry", () => {
  it("discovers boundary.tool workflows live (register/update/unregister)", async () => {
    const { engine, svc } = await boot();
    expect(svc.listWorkflowTools()).toEqual([]);

    engine.registerWorkflow(weatherTool);
    expect(svc.listWorkflowTools()).toMatchObject([
      { name: "get_weather", workflowId: "tool-weather", nodeId: "in" },
    ]);

    engine.unregisterWorkflow("tool-weather");
    expect(svc.listWorkflowTools()).toEqual([]);
  });

  it("warns and keeps the first on a duplicate tool name", async () => {
    const { engine, svc } = await boot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    engine.registerWorkflow(weatherTool);
    engine.registerWorkflow({ ...weatherTool, id: "tool-weather-2" });
    expect(svc.getWorkflowTool("get_weather")?.workflowId).toBe("tool-weather");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("op tools register once and list sorted", async () => {
    const { svc } = await boot();
    svc.registerOpTool({
      name: "now",
      description: "Current time",
      params: { type: "object", properties: {} },
      execute: () => ({ iso: "2026-06-12T00:00:00Z" }),
    });
    expect(svc.listOpTools().map((t) => t.name)).toEqual(["now"]);
    expect(() =>
      svc.registerOpTool({ name: "now", description: "", params: {}, execute: () => null }),
    ).toThrow(/already registered/);
  });
});

describe("boundary.tool execution", () => {
  it("runs as a workflow with engine-validated args", async () => {
    const { engine } = await boot();
    engine.registerWorkflow(weatherTool);

    const ok = await engine.run("tool-weather", { input: { args: { city: "Paris" } } });
    expect(ok.status).toBe("ok");
    const merged = Object.assign({}, ...Object.values(ok.outputs));
    expect(merged.result).toEqual({ city: "Paris" });

    // Malformed args (an LLM hallucinating) die at the trigger, typed.
    const bad = await engine.run("tool-weather", { input: { args: { town: "Paris" } } });
    expect(bad.status).toBe("error");
    expect(bad.error).toBeInstanceOf(TriggerInputError);
  });
});

describe("toolset ops", () => {
  it("agents.tools.workflows picks tools (all, named, unknown throws)", async () => {
    const { engine } = await boot();
    engine.registerWorkflow(weatherTool);
    engine.registerWorkflow({
      id: "pick-tools",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["go"] } },
        { id: "pick", op: "agents.tools.workflows", config: { tools: ["get_weather"] } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "pick", port: "in" } },
        { from: { node: "pick", port: "toolset" }, to: { node: "out", port: "value" } },
      ],
    });
    const res = await engine.run("pick-tools", { input: { go: true } });
    expect(res.status).toBe("ok");
    const merged = Object.assign({}, ...Object.values(res.outputs));
    const toolset = toolsetSchema.parse(merged.value);
    expect(toolset.tools).toMatchObject([{ origin: "workflow", name: "get_weather" }]);
    // Descriptors must survive structured clone (worker transport).
    expect(structuredClone(toolset)).toEqual(toolset);
  });

  it("agents.tools.workflows excludes guardrail-only tools from the default toolset", async () => {
    const { engine, svc } = await boot();
    engine.registerWorkflow(weatherTool);
    engine.registerWorkflow({
      ...weatherTool,
      id: "tool-moderation",
      nodes: weatherTool.nodes.map((n) =>
        n.id === "in" ? { ...n, config: { ...(n.config as object), name: "moderation", guardrail: true } } : n,
      ),
    });
    // Resolvable by name (so agents.guardrail can wrap it)…
    expect(svc.getWorkflowTool("moderation")?.guardrail).toBe(true);

    const pickWith = (tools: string[]): Workflow => ({
      id: `pick-${tools.join("-") || "all"}`,
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["go"] } },
        { id: "pick", op: "agents.tools.workflows", config: { tools } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "pick", port: "in" } },
        { from: { node: "pick", port: "toolset" }, to: { node: "out", port: "value" } },
      ],
    });
    const names = async (tools: string[]) => {
      const wf = pickWith(tools);
      engine.registerWorkflow(wf);
      const res = await engine.run(wf.id, { input: { go: true } });
      const merged = Object.assign({}, ...Object.values(res.outputs));
      return toolsetSchema.parse(merged.value).tools.map((t) => t.name);
    };
    // …but the default (empty) toolset leaves it out — the model never sees it.
    expect(await names([])).toEqual(["get_weather"]);
    // Naming it explicitly is the escape hatch (still includable on purpose).
    expect(await names(["moderation"])).toEqual(["moderation"]);
  });

  it("agents.tools.merge concatenates and de-dups", async () => {
    const { engine } = await boot();
    engine.registerWorkflow(weatherTool);
    engine.registerWorkflow({
      id: "merge-tools",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["go"] } },
        { id: "a", op: "agents.tools.workflows", config: {} },
        { id: "b", op: "agents.tools.workflows", config: { tools: ["get_weather"] } },
        { id: "merge", op: "agents.tools.merge", config: { count: 2 } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "a", port: "in" } },
        { from: { node: "in", port: "out" }, to: { node: "b", port: "in" } },
        { from: { node: "a", port: "toolset" }, to: { node: "merge", port: "tools0" } },
        { from: { node: "b", port: "toolset" }, to: { node: "merge", port: "tools1" } },
        { from: { node: "merge", port: "toolset" }, to: { node: "out", port: "value" } },
      ],
    });
    const res = await engine.run("merge-tools", { input: { go: true } });
    expect(res.status).toBe("ok");
    const merged = Object.assign({}, ...Object.values(res.outputs));
    expect((merged.value as ToolsetDescriptor).tools).toHaveLength(1);
  });

  it("agents.guardrail wraps a tool workflow as a descriptor", async () => {
    const { engine } = await boot();
    engine.registerWorkflow(weatherTool);
    engine.registerWorkflow({
      id: "wrap-guardrail",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["go"] } },
        { id: "g", op: "agents.guardrail", config: { tool: "get_weather", direction: "output" } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "g", port: "in" } },
        { from: { node: "g", port: "guardrail" }, to: { node: "out", port: "value" } },
      ],
    });
    const res = await engine.run("wrap-guardrail", { input: { go: true } });
    const merged = Object.assign({}, ...Object.values(res.outputs));
    expect(merged.value).toEqual({
      kind: "guardrail",
      direction: "output",
      workflowId: "tool-weather",
      name: "get_weather",
    });
  });
});

describe("turn event protocol", () => {
  it("validates every event shape incl. the guaranteed terminal", () => {
    const base = { turnId: "t1", runId: "r1" };
    for (const ev of [
      { ...base, type: "text.delta", delta: "he" },
      { ...base, type: "text.done", text: "hello" },
      { ...base, type: "tool.activity", toolName: "get_weather", phase: "start", args: { city: "Paris" } },
      { ...base, type: "tool.activity", toolName: "get_weather", phase: "done", result: {}, subRunId: "r2" },
      { ...base, type: "audio.ref", blobId: "b1", mime: "audio/wav" },
      {
        ...base,
        type: "approval.request",
        interruption: { id: "i1", toolName: "rm_rf", args: {} },
        stateToken: "opaque",
      },
      { ...base, type: "error", message: "rate limited", code: "rate_limit" },
      { ...base, type: "done", stopReason: "complete" },
    ]) {
      expect(turnEventSchema.safeParse(ev).success, `event ${JSON.stringify(ev)}`).toBe(true);
    }
    expect(turnEventSchema.safeParse({ ...base, type: "done", stopReason: "nope" }).success).toBe(false);
  });
});
