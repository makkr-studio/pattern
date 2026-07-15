/**
 * Restricted tools (0.4.0): a boundary.tool with `restricted: true` is a
 * control-plane tool — every `["*"]` expansion leaves it out (agents toolsets
 * AND the MCP serve op), and MCP tools/call enforces the same exposure set as
 * tools/list. Explicit by-name inclusion is the only way in.
 */

import { describe, expect, it } from "vitest";
import { Engine, type Workflow } from "@pattern-js/core";
import { agentsMod } from "@pattern-js/mod-agents";
import { aiMod } from "../src/mod.js";

const tool = (id: string, name: string, restricted?: boolean): Workflow => ({
  id,
  nodes: [
    {
      id: "in",
      op: "boundary.tool",
      config: {
        name,
        description: `${name} tool`,
        params: { type: "object", properties: {} },
        ...(restricted ? { restricted: true } : {}),
      },
    },
    { id: "tpl", op: "core.string.template", config: { template: `${name}-ran` } },
    { id: "out", op: "boundary.tool.return" },
  ],
  edges: [
    { from: { node: "in", port: "args" }, to: { node: "tpl", port: "data" } },
    { from: { node: "tpl", port: "out" }, to: { node: "out", port: "result" } },
  ],
});

async function boot() {
  const engine = new Engine();
  await engine.useAsync(agentsMod(), { deferReady: true });
  await engine.useAsync(aiMod(), { deferReady: true });
  engine.registerWorkflow(tool("t-open", "open_tool"));
  engine.registerWorkflow(tool("t-priv", "pattern_deploy", true));
  return engine;
}

/** Run a one-shot workflow around agents.tools.workflows and return the toolset. */
async function toolset(engine: Engine, tools: string[]): Promise<{ tools: Array<{ name: string }> }> {
  const wf: Workflow = {
    id: `ts-${tools.join("-") || "all"}`,
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["go"] } },
      { id: "collect", op: "agents.tools.workflows", config: { tools } },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      // Control edge: the collector has no data inputs; this threads reachability.
      { from: { node: "in", port: "out" }, to: { node: "collect", port: "in" } },
      { from: { node: "collect", port: "toolset" }, to: { node: "out", port: "value" } },
    ],
  };
  engine.registerWorkflow(wf);
  const res = await engine.run(wf, { input: { go: 1 } });
  return (res.outputs.out as { value: { tools: Array<{ name: string }> } }).value;
}

/** Drive ai.mcp.serve directly (no HTTP) with a JSON-RPC message. */
async function serve(engine: Engine, cfgTools: string[], msg: object): Promise<Record<string, unknown>> {
  const id = `mcp-${cfgTools.join("-") || "all"}-${JSON.stringify(msg).length}`;
  const wf: Workflow = {
    id,
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ["request"] } },
      { id: "serve", op: "ai.mcp.serve", config: { tools: cfgTools } },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "in", port: "request" }, to: { node: "serve", port: "request" } },
      { from: { node: "serve", port: "response" }, to: { node: "out", port: "value" } },
    ],
  };
  engine.registerWorkflow(wf);
  const res = await engine.run(wf, { input: { request: msg } });
  return (res.outputs.out as { value: Record<string, unknown> }).value;
}

const rpc = (method: string, params?: object) => ({ jsonrpc: "2.0", id: 1, method, params });
const toolNames = (r: Record<string, unknown>) =>
  ((r.result as { tools: Array<{ name: string }> }).tools ?? []).map((t) => t.name);

describe("restricted tools stay out of every wildcard", () => {
  it('agents.tools.workflows [] / ["*"] exclude restricted; by-name includes', async () => {
    const engine = await boot();
    expect((await toolset(engine, [])).tools.map((t) => t.name)).toEqual(["open_tool"]);
    expect((await toolset(engine, ["*"])).tools.map((t) => t.name)).toEqual(["open_tool"]);
    const explicit = await toolset(engine, ["pattern_deploy", "open_tool"]);
    expect(explicit.tools.map((t) => t.name).sort()).toEqual(["open_tool", "pattern_deploy"]);
  });

  it("ai.mcp.serve wildcard hides restricted from tools/list AND tools/call", async () => {
    const engine = await boot();
    expect(await serve(engine, [], rpc("tools/list")).then(toolNames)).toEqual(["open_tool"]);

    // tools/call must enforce the same exposure set — no calling by name what
    // the list would never show.
    const call = await serve(engine, [], rpc("tools/call", { name: "pattern_deploy", arguments: {} }));
    const result = call.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Unknown tool/);
  });

  it("ai.mcp.serve serves a restricted tool when named explicitly", async () => {
    const engine = await boot();
    const named = await serve(engine, ["pattern_deploy"], rpc("tools/list"));
    expect(toolNames(named)).toEqual(["pattern_deploy"]);

    const call = await serve(engine, ["pattern_deploy"], rpc("tools/call", { name: "pattern_deploy", arguments: {} }));
    const result = call.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe("pattern_deploy-ran");
  });
});
