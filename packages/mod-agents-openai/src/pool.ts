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

/**
 * Split a command line into tokens, honoring single/double quotes (so an arg
 * with spaces survives). Unquoted runs of non-space become one token each.
 */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/**
 * Resolve a stdio MCP invocation from the config, the practical way: `command`
 * may be a bare executable OR a whole command line pasted verbatim (e.g. from
 * Docker Desktop: "docker mcp gateway run --profile X") — it's tokenized and any
 * extra tokens become leading args. Explicit `args` are appended. Everything is
 * trimmed and blanks dropped, so a stray trailing space or comma can't ENOENT.
 */
export function stdioInvocation(command: string, args?: string[]): { command: string; args: string[] } {
  const tokens = splitCommand((command ?? "").trim());
  const cmd = tokens[0];
  if (!cmd) throw new Error("agents: a stdio MCP server needs a command");
  return { command: cmd, args: [...tokens.slice(1), ...(args ?? [])].map((a) => a.trim()).filter((a) => a.length > 0) };
}

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
        const { command, args } = stdioInvocation(ref.command, ref.args);
        server = new MCPServerStdio({ command, args, env: ref.env, name: ref.serverLabel });
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
