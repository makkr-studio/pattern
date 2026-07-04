/**
 * `pattern mcp` — the stdio MCP transport (0.4.0).
 *
 * Serves the project's `boundary.tool` workflows to a LOCAL MCP client
 * (Claude Code, Cursor, …) over newline-delimited JSON-RPC on stdio. The
 * protocol handler is mod-ai's `handleMcp` (loaded dynamically — mod-ai is a
 * project dependency, not runtime-node's); this module only supplies the
 * transport and the engine-backed tool source.
 *
 * Trust model: stdio = the developer's own shell = owns the box. Runs execute
 * as `{ id: "local-cli", scopes: ["admin"] }`, and RESTRICTED tools (the
 * pattern_* control plane) ARE exposed — unlike the HTTP wildcard route.
 * Anything written to stdout must be JSON-RPC, so all logging goes to stderr.
 */

import type { Engine, Principal, Workflow } from "@pattern-js/core";

interface WorkflowToolLike {
  workflowId: string;
  nodeId: string;
  name: string;
  description?: string;
  params?: Record<string, unknown>;
  guardrail?: boolean;
}

interface AgentsServiceLike {
  listWorkflowTools(): WorkflowToolLike[];
}

interface McpSourceLike {
  serverInfo: { name: string; version: string };
  listTools(): Array<{ name: string; description?: string; params?: Record<string, unknown> }>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

type HandleMcp = (body: unknown, source: McpSourceLike) => Promise<object | object[] | undefined>;

/** The CLI principal: local stdio access means the operator owns the box. */
const LOCAL_ADMIN: Principal = { kind: "user", id: "local-cli", provider: "cli", scopes: ["admin"] };

async function loadHandler(): Promise<HandleMcp> {
  const spec = "@pattern-js/mod-ai"; // variable specifier ⇒ resolved from the PROJECT, not statically
  // Resolve through the PROJECT's node_modules (anchored at cwd) first — under
  // pnpm's strict layout, runtime-node's own tree can't see undeclared
  // packages; the project's can. Fall back to a plain import (flat installs,
  // tests) before giving up with the install hint.
  try {
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const { resolve } = await import("node:path");
    const req = createRequire(resolve(process.cwd(), "package.json"));
    const mod = (await import(pathToFileURL(req.resolve(spec)).href)) as { handleMcp: HandleMcp };
    if (typeof mod.handleMcp === "function") return mod.handleMcp;
  } catch {
    /* fall through */
  }
  try {
    const mod = (await import(spec)) as { handleMcp: HandleMcp };
    return mod.handleMcp;
  } catch {
    throw new Error(
      "pattern mcp needs @pattern-js/mod-ai installed in this project (it provides the MCP protocol handler) — " +
        "add it to your mods: npm i @pattern-js/mod-ai",
    );
  }
}

/** The engine-backed tool source: every non-guardrail tool, runs as LOCAL_ADMIN. */
function engineSource(engine: Engine, serverInfo: { name: string; version: string }): McpSourceLike {
  const agents = engine.service<AgentsServiceLike>("agentsService");
  if (!agents || typeof agents.listWorkflowTools !== "function") {
    throw new Error(
      "pattern mcp needs @pattern-js/mod-agents installed (its registry discovers boundary.tool workflows) — " +
        "add it to pattern.config.json mods.",
    );
  }
  const tools = () => agents.listWorkflowTools().filter((t) => !t.guardrail);
  return {
    serverInfo,
    listTools: () => tools().map(({ name, description, params }) => ({ name, description, params })),
    callTool: async (name, args) => {
      const reg = tools().find((t) => t.name === name);
      if (!reg) throw new Error(`Unknown tool: ${name}`);
      const wf: Workflow | undefined = engine.workflows.get(reg.workflowId);
      if (!wf) throw new Error(`Tool "${name}" points at unregistered workflow "${reg.workflowId}"`);
      const res = await engine.run(wf, {
        trigger: reg.nodeId,
        input: { args },
        sampleIo: true,
        principal: LOCAL_ADMIN,
      });
      if (res.status !== "ok") {
        throw new Error(res.error instanceof Error ? res.error.message : String(res.error ?? `run ${res.status}`));
      }
      const gate = Object.values(res.outputs)[0] as Record<string, unknown> | undefined;
      return gate?.result === undefined ? gate : gate.result;
    },
  };
}

/**
 * Pump newline-delimited JSON-RPC between stdio and the handler. Resolves when
 * the input closes (the client hung up). `input`/`output` default to the
 * process's stdio; tests pass their own streams.
 */
export async function runMcpStdio(
  engine: Engine,
  opts: {
    name?: string;
    version?: string;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    /** Test seam: inject the protocol handler instead of resolving mod-ai from the project. */
    handler?: HandleMcp;
  } = {},
): Promise<void> {
  const handleMcp = opts.handler ?? (await loadHandler());
  const source = engineSource(engine, { name: opts.name ?? "pattern", version: opts.version ?? "0.0.0" });
  const output = opts.output ?? process.stdout;

  const write = (reply: object | object[] | undefined): void => {
    if (reply === undefined) return; // notification — nothing to send
    if (Array.isArray(reply) && reply.length === 0) return;
    output.write(`${JSON.stringify(reply)}\n`);
  };

  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: opts.input ?? process.stdin, crlfDelay: Infinity });
  console.error(`[pattern] mcp ready on stdio — ${source.listTools().length} tool(s) exposed`);

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    try {
      write(await handleMcp(msg, source));
    } catch (err) {
      const id = (msg as { id?: string | number | null }).id ?? null;
      write({ jsonrpc: "2.0", id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } });
    }
  }
}
