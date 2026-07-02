/**
 * @pattern-js/mod-ai — Pattern AS an MCP server.
 *
 * Exposes Pattern's `boundary.tool` workflows to external MCP clients (Claude
 * Desktop, other agents…) over a stateless StreamableHTTP JSON-RPC endpoint.
 * `tools/list` reads the AgentsRegistry; `tools/call` runs the tool workflow via
 * ctx.invoke (a linked sub-run — same engine validation + tracing as an agent's
 * own tool calls). Pure JSON-RPC over the HTTP boundary; no MCP SDK needed here.
 *
 * Wire: boundary.http.request (POST) → ai.mcp.serve → boundary.http.response.
 * `mcpServerWorkflow()` is the ready-made route (POST /mcp).
 */

import { required, value, z, type OpContext, type OpDefinition, type Workflow } from "@pattern-js/core";
import { agentsService } from "@pattern-js/mod-agents";

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface ServeOpts {
  name: string;
  version: string;
  toolFilter: string[];
}

const ok = (id: JsonRpcMessage["id"], result: unknown) => ({ jsonrpc: "2.0" as const, id: id ?? null, result });
const err = (id: JsonRpcMessage["id"], code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  error: { code, message },
});

/** Handle one JSON-RPC message. Returns undefined for notifications (no reply). */
async function handleOne(ctx: OpContext, msg: JsonRpcMessage, opts: ServeOpts): Promise<object | undefined> {
  const svc = agentsService(ctx);
  switch (msg.method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: (msg.params?.protocolVersion as string) ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: opts.name, version: opts.version },
      });
    case "ping":
      return ok(msg.id, {});
    case "tools/list": {
      const wanted = opts.toolFilter.filter((t) => t !== "*");
      const all = svc.listWorkflowTools().filter((t) => !t.guardrail);
      const picked = wanted.length ? all.filter((t) => wanted.includes(t.name)) : all;
      return ok(msg.id, {
        tools: picked.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          inputSchema: t.params ?? { type: "object", properties: {} },
        })),
      });
    }
    case "tools/call": {
      const name = msg.params?.name as string | undefined;
      const reg = name ? svc.getWorkflowTool(name) : undefined;
      if (!reg) return ok(msg.id, { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true });
      try {
        const outputs = await ctx.invoke({ workflowId: reg.workflowId }, { args: (msg.params?.arguments as object) ?? {} });
        const result = (outputs as Record<string, unknown>).result === undefined ? outputs : (outputs as Record<string, unknown>).result;
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

export const mcpServeOp: OpDefinition = {
  type: "ai.mcp.serve",
  title: "ai.mcp.serve",
  description:
    "Serve Pattern's boundary.tool workflows as an MCP server (stateless StreamableHTTP JSON-RPC). Wire the request " +
    "body into `request` and `response` into boundary.http.response.body. config.tools narrows which tools are exposed.",
  reusable: false,
  config: z.object({
    name: z.string().default("pattern"),
    version: z.string().default("0.2.2"),
    /** Tool names to expose; empty (or ["*"]) = every non-guardrail tool. */
    tools: z.array(z.string()).default([]),
  }),
  inputs: { request: required() },
  outputs: { response: value() },
  execute: async (ctx) => {
    const cfg = ctx.config as { name: string; version: string; tools: string[] };
    const body = await ctx.input.value<unknown>("request");
    const opts: ServeOpts = { name: cfg.name, version: cfg.version, toolFilter: cfg.tools };
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handleOne(ctx, m as JsonRpcMessage, opts)))).filter(Boolean);
      return { response: out };
    }
    const res = await handleOne(ctx, body as JsonRpcMessage, opts);
    // Notifications produce no JSON-RPC reply; return an empty object body (200).
    return { response: res ?? {} };
  },
};

/**
 * A ready-made MCP server route at POST /mcp exposing every tool. To narrow the
 * exposed tools, build your own workflow: boundary.http.request → ai.mcp.serve
 * (config.tools: [...]) → boundary.http.response.
 */
export function mcpServerWorkflow(opts: { path?: string } = {}): Workflow {
  const path = opts.path ?? "/mcp";
  // The WHOLE request body (the JSON-RPC message) flows into `request` — a
  // per-field fromBody() mapping would only pick a named field, not the message.
  return {
    id: "ai.mcp.server",
    name: `AI · MCP server (POST ${path})`,
    description:
      `Exposes this app's tool workflows to MCP clients over HTTP at ${path}: the whole JSON-RPC message flows ` +
      "into ai.mcp.serve, which lists and calls every boundary.tool workflow. Fork it to narrow the toolset " +
      "(config.tools) or move the path.",
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "POST", path }, ui: { x: 60, y: 60, pair: "out" } },
      { id: "serve", op: "ai.mcp.serve", comment: "MCP over JSON-RPC: initialize / tools/list / tools/call.", ui: { x: 340, y: 60 } },
      { id: "out", op: "boundary.http.response", ui: { x: 620, y: 60, pair: "in" } },
    ],
    edges: [
      { from: { node: "in", port: "body" }, to: { node: "serve", port: "request" } },
      { from: { node: "serve", port: "response" }, to: { node: "out", port: "body" } },
    ],
  };
}
