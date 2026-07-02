import { afterEach, describe, expect, it } from "vitest";
import { Engine, type Workflow } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";
import { agentsMod } from "@pattern-js/mod-agents";
import { aiMod } from "../src/mod.js";
import { McpService } from "../src/mcp.js";

/**
 * The MCP round-trip, both directions in one test: mod-ai's MCP CLIENT connects
 * to Pattern's own MCP SERVER (the /mcp route exposing boundary.tool workflows),
 * lists the tool, and calls it — which runs the tool workflow via ctx.invoke.
 */

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

const weatherTool: Workflow = {
  id: "tool-weather",
  nodes: [
    {
      id: "in",
      op: "boundary.tool",
      config: {
        name: "get_weather",
        description: "Current weather for a city",
        params: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      },
    },
    { id: "tpl", op: "core.string.template", config: { template: "sunny in {{city}}" } },
    { id: "out", op: "boundary.tool.return" },
  ],
  edges: [
    { from: { node: "in", port: "args" }, to: { node: "tpl", port: "data" } },
    { from: { node: "tpl", port: "out" }, to: { node: "out", port: "result" } },
  ],
};

describe("MCP round-trip (Pattern server ↔ mod-ai client)", () => {
  it("lists and calls a Pattern tool over MCP", async () => {
    const engine = new Engine();
    await engine.useAsync(agentsMod(), { deferReady: true });
    await engine.useAsync(aiMod(), { deferReady: true });
    engine.registerWorkflow(weatherTool);

    const host = createHttpHost(engine, { defaultPort: 4977 });
    const started = await host.start();
    closer = started.close;
    const url = `http://localhost:${started.port ?? 4977}/mcp`;

    const mcp = new McpService();
    const ref = { origin: "mcp", transport: "http", url } as const;

    const tools = await mcp.listTools(ref);
    expect(tools.map((t) => t.name)).toContain("get_weather");
    const weather = tools.find((t) => t.name === "get_weather");
    expect(weather?.parameters).toMatchObject({ type: "object" });

    const result = await mcp.callTool(ref, "get_weather", { city: "Paris" });
    expect(result).toBe("sunny in Paris");
  }, 20_000);
});
