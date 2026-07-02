/**
 * @pattern-js/mod-ai — the MCP client seam (AiMcpService).
 *
 * Resolves `agents.mcp.client` tool refs against real MCP servers using the
 * official @modelcontextprotocol/sdk (the AI SDK dropped its built-in MCP
 * client in v6). Connections are LONG-LIVED (handshake + discovery are
 * expensive); runs are short — so we pool one client per descriptor for the
 * process, exactly like the retired @openai/agents pool.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AiMcpService, McpToolRef, NeutralToolDef } from "@pattern-js/mod-agents";

/** Split a command line into tokens, honoring single/double quotes. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/** `command` may be a bare executable OR a whole command line; extra tokens become leading args. */
export function stdioInvocation(command: string, args?: string[]): { command: string; args: string[] } {
  const tokens = splitCommand((command ?? "").trim());
  const cmd = tokens[0];
  if (!cmd) throw new Error("mod-ai: a stdio MCP server needs a command");
  return { command: cmd, args: [...tokens.slice(1), ...(args ?? [])].map((a) => a.trim()).filter((a) => a.length > 0) };
}

/** A safe string-only env for the child process (keeps PATH etc.), merged with the ref's env. */
function childEnv(extra?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") base[k] = v;
  return { ...base, ...(extra ?? {}) };
}

const keyOf = (ref: McpToolRef): string =>
  JSON.stringify([ref.transport, ref.url, ref.command, ref.args, ref.env, ref.serverLabel, ref.headers]);

const pool = new Map<string, Promise<Client>>();

function clientFor(ref: McpToolRef): Promise<Client> {
  const key = keyOf(ref);
  let entry = pool.get(key);
  if (!entry) {
    entry = (async () => {
      const client = new Client({ name: "pattern", version: "0.2.2" });
      if (ref.transport === "http") {
        if (!ref.url) throw new Error("mod-ai: an http MCP server needs a url");
        const transport = new StreamableHTTPClientTransport(new URL(ref.url), {
          requestInit: ref.headers ? { headers: ref.headers } : undefined,
        });
        await client.connect(transport);
      } else {
        const { command, args } = stdioInvocation(ref.command ?? "", ref.args);
        const transport = new StdioClientTransport({ command, args, env: childEnv(ref.env) });
        await client.connect(transport);
      }
      return client;
    })();
    // A failed connect must not poison the pool forever.
    entry.catch(() => pool.delete(key));
    pool.set(key, entry);
  }
  return entry;
}

/** MCP tool results are content blocks; prefer structured output, else joined text. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractContent(result: any): unknown {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const content: Array<{ type?: string; text?: string }> = result?.content ?? [];
  const texts = content.filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text as string);
  if (texts.length) return texts.join("\n");
  return content;
}

export class McpService implements AiMcpService {
  async listTools(ref: McpToolRef): Promise<NeutralToolDef[]> {
    const client = await clientFor(ref);
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      // The MCP inputSchema IS a JSON Schema — exactly what NeutralToolDef wants.
      parameters: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
      needsApproval: false,
    }));
  }

  async callTool(ref: McpToolRef, name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await clientFor(ref);
    const result = await client.callTool({ name, arguments: args });
    return extractContent(result);
  }
}
