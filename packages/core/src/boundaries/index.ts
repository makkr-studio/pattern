/**
 * §7 — Boundaries.
 *
 * Boundaries connect the graph to the outside world. The op **contracts and
 * payload schemas live here in core**; the **host** that binds an external
 * source to a trigger and writes the out-gate result is the runtime adapter
 * (`@pattern/runtime-node`). This keeps core runtime-neutral and serves
 * distribution.
 *
 * Triggers have no graph inputs — their outputs are seeded from the external
 * input by the engine, so their `execute` is never called. Out-gates have no
 * graph outputs — their resolved inputs ARE the external payload the host writes.
 */

import { z } from "zod";
import { required, stream, value } from "../ops-core/helpers.js";
import { jsonSchemaToZod } from "../json-schema.js";
import type { OpDefinition, Ports } from "../types.js";

const recordSchema = z.record(z.string(), z.unknown());
const stringRecord = z.record(z.string(), z.string());
const connectionSchema = z.union([z.string(), z.object({ id: z.string() }).loose()]);
const requireAuth = z
  .union([z.boolean(), z.object({ scopes: z.array(z.string()) })])
  .optional();

/** A JSON-Schema object carried in op config (compiled to Zod by the host). */
const jsonSchema = z.record(z.string(), z.unknown());

/** Declarative CORS policy for an HTTP route (§7). */
export const corsConfigSchema = z.union([
  z.boolean(),
  z.object({
    origin: z.union([z.string(), z.array(z.string())]).default("*"),
    methods: z.array(z.string()).optional(),
    headers: z.array(z.string()).optional(),
    credentials: z.boolean().default(false),
    maxAge: z.number().int().optional(),
    exposeHeaders: z.array(z.string()).optional(),
  }),
]);

/** Triggers never run their execute (the engine seeds outputs). */
const TRIGGER_EXECUTE = () => ({});

/** Build an out-gate whose resolved inputs become the external payload. */
function outgate(opts: {
  type: string;
  description: string;
  inputs: Ports;
  config?: z.ZodType;
}): OpDefinition {
  return {
    type: opts.type,
    title: opts.type,
    description: opts.description,
    boundary: "outgate",
    inputs: opts.inputs,
    outputs: {},
    config: opts.config,
    execute: async (ctx) => {
      const out: Record<string, unknown> = { ...(ctx.config as object) };
      for (const [port, spec] of Object.entries(opts.inputs)) {
        if (spec.kind === "stream") {
          if (ctx.input.has(port)) out[port] = ctx.input.stream(port);
        } else if (spec.kind === "value") {
          out[port] = await ctx.input.value(port);
        }
      }
      return out;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// manual / schedule / generic return
// ────────────────────────────────────────────────────────────────────────────

export const manual: OpDefinition = {
  type: "boundary.manual",
  title: "boundary.manual",
  description: "Programmatic trigger. config.outputs declares the output ports seeded from the run input.",
  boundary: "trigger",
  inputs: {},
  outputs: (config: { outputs?: string[] }): Ports =>
    Object.fromEntries((config.outputs ?? ["value"]).map((p) => [p, value()])),
  config: z.object({ outputs: z.array(z.string()).default(["value"]), requireAuth }),
  execute: TRIGGER_EXECUTE,
};

export const schedule: OpDefinition = {
  type: "boundary.schedule",
  title: "boundary.schedule",
  description: "Cron/interval trigger. Outputs { timestamp }. config: { cron? | intervalMs? }.",
  boundary: "trigger",
  inputs: {},
  outputs: { timestamp: value(z.number()), scheduledFor: value(z.number()) },
  config: z.object({ cron: z.string().optional(), intervalMs: z.number().int().positive().optional(), requireAuth }),
  execute: TRIGGER_EXECUTE,
};

export const returnGate = outgate({
  type: "boundary.return",
  description: "Generic out-gate: returns its resolved inputs as the run result. config.inputs declares the ports.",
  inputs: { value: value() },
});

/** A `boundary.return` whose input ports are configurable (for sub-workflows). */
export const returnGateConfigurable: OpDefinition = {
  type: "boundary.return.named",
  title: "boundary.return.named",
  description: "Out-gate with configurable input ports. config: { inputs: string[] }.",
  boundary: "outgate",
  inputs: (config: { inputs?: string[] }): Ports =>
    Object.fromEntries((config.inputs ?? ["value"]).map((p) => [p, value()])),
  outputs: {},
  config: z.object({ inputs: z.array(z.string()).default(["value"]) }),
  execute: async (ctx) => {
    const { inputs } = ctx.config as { inputs: string[] };
    const out: Record<string, unknown> = {};
    for (const p of inputs) out[p] = await ctx.input.value(p);
    return out;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// HTTP
// ────────────────────────────────────────────────────────────────────────────

export const httpRequest: OpDefinition = {
  type: "boundary.http.request",
  title: "boundary.http.request",
  description:
    "Inbound HTTP request trigger. The route is declared here: method, path, port, " +
    "cors, and JSON-Schema validation of body/query. Outputs { method, url, path, " +
    "headers, query, params, body }.",
  boundary: "trigger",
  inputs: {},
  // Output port schemas are derived from the declared body/query schemas, so the
  // graph is typed end-to-end and downstream value edges are checked.
  outputs: (config: { bodyMode?: string; body?: unknown; query?: unknown }): Ports => ({
    method: value(z.string()),
    url: value(z.string()),
    path: value(z.string()),
    headers: value(stringRecord),
    query: value(config.query ? jsonSchemaToZod(config.query as any) : stringRecord),
    params: value(stringRecord),
    body:
      config.bodyMode === "stream"
        ? stream(z.instanceof(Uint8Array))
        : value(config.body ? jsonSchemaToZod(config.body as any) : z.unknown()),
  }),
  config: z.object({
    /** HTTP method to match. Use "ANY" to match all. */
    method: z.string().default("GET"),
    /** Path pattern with :params, e.g. "/users/:id". Required to be routable. */
    path: z.string().optional(),
    /** Port to serve this route on (defaults to the host's default port). */
    port: z.number().int().positive().optional(),
    /** CORS policy for this route. */
    cors: corsConfigSchema.optional(),
    /** JSON Schema validating the request body (400 on mismatch). */
    body: jsonSchema.optional(),
    /** JSON Schema validating the query parameters (400 on mismatch). */
    query: jsonSchema.optional(),
    /** "buffered" parses the whole body; "stream" hands a byte stream to the graph. */
    bodyMode: z.enum(["buffered", "stream"]).default("buffered"),
    requireAuth,
  }),
  execute: TRIGGER_EXECUTE,
};

export const httpResponse = outgate({
  type: "boundary.http.response",
  description: "HTTP response out-gate. mode: buffered | sse | chunked. Inputs { status?, headers?, body }.",
  inputs: { status: value(z.number()), headers: value(stringRecord), body: value(), stream: stream() },
  config: z.object({ mode: z.enum(["buffered", "sse", "chunked"]).default("buffered") }),
});

// ────────────────────────────────────────────────────────────────────────────
// WebSocket
// ────────────────────────────────────────────────────────────────────────────

export const wsMessage: OpDefinition = {
  type: "boundary.ws.message",
  title: "boundary.ws.message",
  description: "Fires a run per inbound WS message. Outputs { message, connection, room? }.",
  boundary: "trigger",
  inputs: {},
  outputs: { message: value(), connection: value(connectionSchema), room: value(z.string()) },
  config: z.object({ requireAuth }),
  execute: TRIGGER_EXECUTE,
};

export const wsOpen: OpDefinition = {
  type: "boundary.ws.open",
  title: "boundary.ws.open",
  description: "Connection-opened trigger. Outputs { connection }.",
  boundary: "trigger",
  inputs: {},
  outputs: { connection: value(connectionSchema) },
  config: z.object({ requireAuth }),
  execute: TRIGGER_EXECUTE,
};

export const wsClose: OpDefinition = {
  type: "boundary.ws.close",
  title: "boundary.ws.close",
  description: "Connection-closed trigger. Outputs { connection, code?, reason? }.",
  boundary: "trigger",
  inputs: {},
  outputs: { connection: value(connectionSchema), code: value(z.number()), reason: value(z.string()) },
  execute: TRIGGER_EXECUTE,
};

export const wsSend = outgate({
  type: "boundary.ws.send",
  description: "Sends the run's result back on the connection (value, or `stream` for chunked sends).",
  inputs: { message: value(), stream: stream() },
});

// ────────────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────────────

export const cli: OpDefinition = {
  type: "boundary.cli",
  title: "boundary.cli",
  description: "CLI process trigger. Outputs { args, parsed, stdin, env }.",
  boundary: "trigger",
  inputs: {},
  outputs: {
    args: value(z.array(z.string())),
    parsed: value(recordSchema),
    stdin: stream(z.instanceof(Uint8Array)),
    env: value(stringRecord),
  },
  config: z.object({ requireAuth }),
  execute: TRIGGER_EXECUTE,
};

export const cliExit = outgate({
  type: "boundary.cli.exit",
  description: "CLI exit out-gate. Inputs { stdout (value/stream), stderr, code }.",
  inputs: { stdout: value(), stdoutStream: stream(), stderr: value(z.string()), code: value(z.number()) },
});

// ────────────────────────────────────────────────────────────────────────────
// Hook / Event
// ────────────────────────────────────────────────────────────────────────────

export const hookTrigger: OpDefinition = {
  type: "boundary.hook",
  title: "boundary.hook",
  description: "Filter-chain member (§8). config: { hook, priority? }. Outputs { payload }.",
  boundary: "trigger",
  inputs: {},
  outputs: { payload: value() },
  config: z.object({ hook: z.string(), priority: z.number().default(100) }),
  execute: TRIGGER_EXECUTE,
};

export const hookReturn = outgate({
  type: "boundary.hook.return",
  description: "Hook member out-gate: returns { payload, stop? } to thread/short-circuit the chain (§8).",
  inputs: { payload: required(), stop: value(z.boolean()) },
});

export const eventTrigger: OpDefinition = {
  type: "boundary.event",
  title: "boundary.event",
  description: "Fire-and-forget subscriber (§8). config: { event }. Outputs { payload }. No out-gate.",
  boundary: "trigger",
  inputs: {},
  outputs: { payload: value() },
  config: z.object({ event: z.string() }),
  execute: TRIGGER_EXECUTE,
};

export const boundaryOps: OpDefinition[] = [
  manual,
  schedule,
  returnGate,
  returnGateConfigurable,
  httpRequest,
  httpResponse,
  wsMessage,
  wsOpen,
  wsClose,
  wsSend,
  cli,
  cliExit,
  hookTrigger,
  hookReturn,
  eventTrigger,
];

// Re-export the control-port constants for adapters building boundary graphs.
export { CONTROL_IN, CONTROL_OUT } from "../types.js";
