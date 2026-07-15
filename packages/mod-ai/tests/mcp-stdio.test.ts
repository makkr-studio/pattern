/**
 * `pattern mcp` stdio transport: newline-delimited JSON-RPC in/out, tools
 * running as the local admin principal, RESTRICTED tools exposed (stdio =
 * the developer's own shell). The protocol handler is injected (the CLI
 * resolves it from the project; tests hand it over directly).
 */

import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { Engine, type Workflow } from "@pattern-js/core";
import { runMcpStdio } from "@pattern-js/runtime-node";
import { agentsMod } from "@pattern-js/mod-agents";
import { handleMcp } from "../src/mcp-server.js";

/** A tool that answers with the CALLER's principal id (via the user port). */
const whoamiTool: Workflow = {
  id: "tool-whoami",
  nodes: [
    {
      id: "in",
      op: "boundary.tool",
      config: { name: "who_am_i", description: "The caller's identity", params: { type: "object", properties: {} }, restricted: true },
    },
    { id: "pick", op: "core.object.get", config: { path: "id" } },
    { id: "out", op: "boundary.tool.return" },
  ],
  edges: [
    { from: { node: "in", port: "user" }, to: { node: "pick", port: "object" } },
    { from: { node: "pick", port: "out" }, to: { node: "out", port: "result" } },
  ],
};

async function session(messages: object[]): Promise<Array<Record<string, unknown>>> {
  const engine = new Engine();
  await engine.useAsync(agentsMod(), { deferReady: true });
  engine.registerWorkflow(whoamiTool);

  const input = new PassThrough();
  const output = new PassThrough();
  // Accumulate as data flows — a single output.read() after `done` races the
  // PassThrough's transform ticks and can observe only the first chunk.
  const chunks: Buffer[] = [];
  output.on("data", (c: Buffer) => chunks.push(c));
  const done = runMcpStdio(engine, { name: "pattern-test", version: "0.0.1", input, output, handler: handleMcp });
  for (const m of messages) input.write(`${JSON.stringify(m)}\n`);
  input.write("not json\n"); // parse errors answer -32700, never kill the session
  input.end();
  await done;
  await new Promise((r) => setImmediate(r)); // let the final writes flush through

  return Buffer.concat(chunks)
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("pattern mcp (stdio)", () => {
  it("initialize → tools/list → tools/call, running as the local admin", async () => {
    const replies = await session([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "who_am_i", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } },
    ]);

    const byId = new Map(replies.map((r) => [r.id, r]));
    expect((byId.get(1)?.result as { serverInfo: { name: string } }).serverInfo.name).toBe("pattern-test");

    // stdio exposes RESTRICTED tools — local access is owner access.
    const tools = (byId.get(2)?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toContain("who_am_i");

    const call = byId.get(3)?.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(call.isError).toBeUndefined();
    expect(call.content[0]?.text).toBe("local-cli");

    const unknown = byId.get(4)?.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(unknown.isError).toBe(true);

    // The junk line answered -32700 without killing the session.
    expect(replies.some((r) => (r.error as { code?: number } | undefined)?.code === -32700)).toBe(true);
  });
});
