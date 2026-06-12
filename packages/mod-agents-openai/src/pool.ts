/**
 * @pattern/mod-agents-openai — MCP server pool.
 *
 * MCP connections are LONG-LIVED (handshake + tool discovery are expensive);
 * runs are short. The pool keys servers by their descriptor (a stable JSON
 * hash) and connects on first use — every agents.run with the same MCP ref
 * shares one connection. Servers live for the process (documented).
 */

import { MCPServerStdio, MCPServerStreamableHttp, type MCPServer } from "@openai/agents";
import type { ToolRef } from "@pattern/mod-agents";

type McpRef = Extract<ToolRef, { origin: "mcp" }>;

const pool = new Map<string, Promise<MCPServer>>();

function keyOf(ref: McpRef): string {
  return JSON.stringify([ref.transport, ref.url, ref.command, ref.args, ref.env, ref.serverLabel]);
}

export function mcpServerFor(ref: McpRef): Promise<MCPServer> {
  const key = keyOf(ref);
  let entry = pool.get(key);
  if (!entry) {
    entry = (async () => {
      let server: MCPServer;
      if (ref.transport === "http") {
        if (!ref.url) throw new Error("agents: an http MCP server needs a url");
        server = new MCPServerStreamableHttp({
          url: ref.url,
          requestInit: ref.headers ? { headers: ref.headers } : undefined,
          name: ref.serverLabel,
        });
      } else {
        if (!ref.command) throw new Error("agents: a stdio MCP server needs a command");
        server = new MCPServerStdio({
          command: ref.command,
          args: ref.args,
          env: ref.env,
          name: ref.serverLabel,
        });
      }
      await server.connect();
      return server;
    })();
    // A failed connect must not poison the pool forever.
    entry.catch(() => pool.delete(key));
    pool.set(key, entry);
  }
  return entry;
}
