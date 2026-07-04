/**
 * @pattern-js/mod-ai — Pattern AS an MCP server.
 *
 * Exposes Pattern's `boundary.tool` workflows to external MCP clients (Claude
 * Desktop, Claude Code, other agents…) as stateless JSON-RPC. The protocol
 * handler (`handleMcp`) is decoupled from HTTP via a pluggable `McpSource`,
 * so the SAME handler serves the StreamableHTTP route here and the
 * `pattern mcp` stdio transport in runtime-node.
 *
 * Wire: boundary.http.request (POST) → ai.mcp.serve → boundary.http.response.
 * `mcpServerWorkflow()` is the ready-made route (POST /mcp) — public by
 * default for local dev; pass `auth` to gate it (production posture: scoped
 * API tokens via mod-identity).
 */

import { required, value, z, type OpContext, type OpDefinition, type Workflow } from "@pattern-js/core";
import { agentsService } from "@pattern-js/mod-agents";

const PROTOCOL_VERSION = "2025-06-18";

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/** What an MCP transport needs from its tool provider — nothing else. */
export interface McpSource {
  serverInfo: { name: string; version: string };
  /** The EXPOSED tools — list and call must agree on this set. */
  listTools(): McpToolInfo[] | Promise<McpToolInfo[]>;
  /** Run a tool by name. Throw for unknown tools and failures (becomes isError content). */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  /** JSON Schema for the arguments. */
  params?: Record<string, unknown>;
}

const ok = (id: JsonRpcMessage["id"], result: unknown) => ({ jsonrpc: "2.0" as const, id: id ?? null, result });
const err = (id: JsonRpcMessage["id"], code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  error: { code, message },
});

/** Handle one JSON-RPC message. Returns undefined for notifications (no reply). */
async function handleOne(msg: JsonRpcMessage, source: McpSource): Promise<object | undefined> {
  switch (msg.method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: (msg.params?.protocolVersion as string) ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: source.serverInfo,
      });
    case "ping":
      return ok(msg.id, {});
    case "tools/list": {
      const tools = await source.listTools();
      return ok(msg.id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          inputSchema: t.params ?? { type: "object", properties: {} },
        })),
      });
    }
    case "tools/call": {
      const name = msg.params?.name as string | undefined;
      try {
        if (!name) throw new Error("Unknown tool: (missing name)");
        const result = await source.callTool(name, (msg.params?.arguments as Record<string, unknown>) ?? {});
        const text = typeof result === "string" ? result : JSON.stringify(result);
        return ok(msg.id, { content: [{ type: "text", text }] });
      } catch (e) {
        return ok(msg.id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      // Notifications (no id) get no reply; unknown requests get method-not-found.
      if (msg.id === undefined || msg.id === null) return undefined;
      return err(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/**
 * The transport-agnostic MCP handler: single messages or batches in, JSON-RPC
 * replies out (undefined = notification, nothing to send). Both the HTTP
 * serve op and the `pattern mcp` stdio transport delegate here.
 */
export async function handleMcp(
  body: unknown,
  source: McpSource,
): Promise<object | object[] | undefined> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleOne(m as JsonRpcMessage, source)))).filter(
      (r): r is object => Boolean(r),
    );
    return out;
  }
  return handleOne(body as JsonRpcMessage, source);
}

/**
 * The engine-backed source: exposed tools come from the AgentsRegistry, calls
 * run the tool workflow via ctx.invoke (a linked, traced sub-run with engine
 * arg validation). `toolFilter` narrows exposure; `["*"]`/empty exposes every
 * non-guardrail, NON-RESTRICTED tool — control-plane tools must be named
 * explicitly. tools/call enforces the SAME set as tools/list, so narrowing
 * the config is a real boundary, not a menu.
 */
export function workflowToolSource(
  ctx: OpContext,
  opts: { name: string; version: string; toolFilter: string[] },
): McpSource {
  const svc = agentsService(ctx);
  const exposed = (): Map<string, McpToolInfo & { workflowId: string }> => {
    const wanted = opts.toolFilter.filter((t) => t !== "*");
    const all = svc.listWorkflowTools().filter((t) => !t.guardrail);
    const picked = wanted.length ? all.filter((t) => wanted.includes(t.name)) : all.filter((t) => !t.restricted);
    return new Map(picked.map((t) => [t.name, t]));
  };
  return {
    serverInfo: { name: opts.name, version: opts.version },
    listTools: () => [...exposed().values()].map(({ name, description, params }) => ({ name, description, params })),
    callTool: async (name, args) => {
      const reg = exposed().get(name);
      if (!reg) throw new Error(`Unknown tool: ${name}`);
      const outputs = await ctx.invoke({ workflowId: reg.workflowId }, { args });
      const record = outputs as Record<string, unknown>;
      return record.result === undefined ? outputs : record.result;
    },
  };
}

export const mcpServeOp: OpDefinition = {
  type: "ai.mcp.serve",
  title: "ai.mcp.serve",
  description:
    "Serve Pattern's boundary.tool workflows as an MCP server (stateless StreamableHTTP JSON-RPC). Wire the request " +
    "body into `request` and `response` into boundary.http.response.body. config.tools narrows which tools are exposed " +
    "(restricted tools are only served when named explicitly).",
  reusable: false,
  config: z.object({
    name: z.string().default("pattern"),
    version: z.string().default("0.4.0"),
    /** Tool names to expose; empty (or ["*"]) = every non-guardrail, non-restricted tool. */
    tools: z.array(z.string()).default([]),
  }),
  inputs: { request: required() },
  outputs: { response: value() },
  execute: async (ctx) => {
    const cfg = ctx.config as { name: string; version: string; tools: string[] };
    const body = await ctx.input.value<unknown>("request");
    const source = workflowToolSource(ctx, { name: cfg.name, version: cfg.version, toolFilter: cfg.tools });
    const res = await handleMcp(body, source);
    // Notifications produce no JSON-RPC reply; return an empty object body (200).
    return { response: res ?? {} };
  },
};

/**
 * A ready-made MCP server route at POST /mcp exposing every non-restricted
 * tool. PUBLIC by default (local-dev posture) — pass `auth` to gate it, e.g.
 * `{ scopes: ["workflows:read"] }` with mod-identity's API tokens installed.
 * To narrow the exposed tools, fork it or build your own: boundary.http.request
 * → ai.mcp.serve (config.tools: [...]) → boundary.http.response.
 */
export function mcpServerWorkflow(
  opts: { path?: string; auth?: boolean | { scopes: string[] } | { env: string } } = {},
): Workflow {
  const path = opts.path ?? "/mcp";
  // The WHOLE request body (the JSON-RPC message) flows into `request` — a
  // per-field fromBody() mapping would only pick a named field, not the message.
  return {
    id: "ai.mcp.server",
    name: `AI · MCP server (POST ${path})`,
    description:
      `Exposes this app's tool workflows to MCP clients over HTTP at ${path}: the whole JSON-RPC message flows ` +
      "into ai.mcp.serve, which lists and calls every non-restricted boundary.tool workflow. Fork it to narrow " +
      "the toolset (config.tools), gate it (requireAuth), or move the path.",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        config: { method: "POST", path, ...(opts.auth !== undefined ? { requireAuth: opts.auth } : {}) },
        ui: { x: 60, y: 60, pair: "out" },
      },
      { id: "serve", op: "ai.mcp.serve", comment: "MCP over JSON-RPC: initialize / tools/list / tools/call.", ui: { x: 340, y: 60 } },
      { id: "out", op: "boundary.http.response", ui: { x: 620, y: 60, pair: "in" } },
    ],
    edges: [
      { from: { node: "in", port: "body" }, to: { node: "serve", port: "request" } },
      { from: { node: "serve", port: "response" }, to: { node: "out", port: "body" } },
    ],
  };
}
