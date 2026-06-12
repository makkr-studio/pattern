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
import { userInputSchema } from "../auth/well-known.js";
import type { OpDefinition, Ports } from "../types.js";

const recordSchema = z.record(z.string(), z.unknown());
const stringRecord = z.record(z.string(), z.string());
const connectionSchema = z.union([z.string(), z.object({ id: z.string() }).loose()]);
const requireAuth = z
  .union([
    z.boolean(),
    z.object({ scopes: z.array(z.string()) }),
    // Deferred form: the host resolves the env var per request (engine.authorize).
    z.object({ env: z.string().min(1) }),
  ])
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

/**
 * The `user` output port carried by host-bound triggers (§9): the resolved
 * principal flattened for wiring, or null when anonymous. Hosts seed it from
 * `engine.authenticate`; an unseeded port simply arrives undefined.
 */
const userPort = () => value(userInputSchema);

/** Build an out-gate whose resolved inputs become the external payload. */
function outgate(opts: {
  type: string;
  description: string;
  inputs: Ports;
  config?: z.ZodType;
  reusable?: boolean;
  /** The trigger op this out-gate canonically pairs with (§7). */
  pair?: string;
}): OpDefinition {
  return {
    type: opts.type,
    title: opts.type,
    description: opts.description,
    boundary: "outgate",
    reusable: opts.reusable,
    pair: opts.pair,
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
  pair: "boundary.return",
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
  pair: "boundary.return",
  inputs: {},
  // Registration-time config ports: wire env/const values into the timing.
  configInputs: {
    cron: value(z.string()),
    intervalMs: value(z.number().int().positive()),
  },
  outputs: { timestamp: value(z.number()), scheduledFor: value(z.number()) },
  config: z.object({ cron: z.string().optional(), intervalMs: z.number().int().positive().optional(), requireAuth }),
  execute: TRIGGER_EXECUTE,
};

export const returnGate = outgate({
  type: "boundary.return",
  description: "Generic out-gate: returns its resolved inputs as the run result. config.inputs declares the ports.",
  inputs: { value: value() },
  pair: "boundary.manual",
});

/** A `boundary.return` whose input ports are configurable (for sub-workflows). */
export const returnGateConfigurable: OpDefinition = {
  type: "boundary.return.named",
  title: "boundary.return.named",
  description: "Out-gate with configurable input ports. config: { inputs: string[] }.",
  boundary: "outgate",
  reusable: false,
  pair: "boundary.manual",
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
    "cors, and JSON-Schema validation of body/query/params. Outputs { method, url, " +
    "path, headers, query, params, body, user }.",
  boundary: "trigger",
  pair: "boundary.http.response",
  inputs: {},
  // Registration-time config ports: wire an op (e.g. core.env) into method/path/
  // port — or a `core.schema.define` node into body/query/params — and the engine
  // resolves it once at registration (the resolve phase).
  configInputs: {
    method: value(z.string()),
    path: value(z.string()),
    port: value(z.number().int().positive()),
    body: value(jsonSchema),
    query: value(jsonSchema),
    params: value(jsonSchema),
  },
  // Output port schemas are derived from the declared body/query/params schemas,
  // so the graph is typed end-to-end and downstream value edges are checked.
  // Declared schemas are flagged `validate`: the engine enforces them on every
  // run's seeded input, whatever the entry path (host, editor run, invoke).
  // Query/params arrive as URL strings, so their compiled schemas coerce.
  outputs: (config: { bodyMode?: string; body?: unknown; query?: unknown; params?: unknown }): Ports => ({
    method: value(z.string()),
    url: value(z.string()),
    path: value(z.string()),
    headers: value(stringRecord),
    user: userPort(),
    query: config.query ? value(jsonSchemaToZod(config.query as any, { coerce: true }), { validate: true }) : value(stringRecord),
    params: config.params ? value(jsonSchemaToZod(config.params as any, { coerce: true }), { validate: true }) : value(stringRecord),
    body:
      config.bodyMode === "stream"
        ? stream(z.instanceof(Uint8Array))
        : config.body
          ? value(jsonSchemaToZod(config.body as any), { validate: true })
          : value(z.unknown()),
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
    /** JSON Schema validating the path params extracted from `path` (400 on mismatch). */
    params: jsonSchema.optional(),
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
  pair: "boundary.http.request",
});

/**
 * What an app workflow's out-gate delivers to the host: a serveable app — the
 * filesystem its assets live on plus serving hints. Produced by app ops
 * (`core.app.static`, a mod's own app node like `admin.app`); consumed by
 * `boundary.http.app.serve`. `.loose()` so richer app objects can flow through.
 */
export const appDescriptorSchema = z
  .object({
    /** Name of a filesystem registered on the engine (host resolves it). */
    filesystem: z.string(),
    /** Served on a miss when the client accepts HTML (client-side routing). "" disables. */
    spaFallback: z.string().optional(),
    /** Send long-lived immutable cache headers (use with hashed filenames). */
    immutableAssets: z.boolean().optional(),
  })
  .loose();

export type AppDescriptor = z.infer<typeof appDescriptorSchema>;

/**
 * App-serving boundary (admin-spec P1) — the HTTP side of an app workflow.
 * The trigger declares the route-ish things (mount, port, CORS, auth); the app
 * itself (which filesystem, SPA fallback…) is produced by an app op downstream
 * (e.g. `core.app.static`, or a mod-provided node like `admin.app`) and handed
 * to the paired `boundary.http.app.serve` out-gate. The host runs the workflow
 * once at registration to resolve the app, then serves it statically.
 */
export const httpApp: OpDefinition = {
  type: "boundary.http.app",
  title: "boundary.http.app",
  description:
    "App mount trigger: declares where an app is served (mount, port, cors, auth). Wire it to an " +
    "app op (e.g. core.app.static) feeding the paired boundary.http.app.serve out-gate; the host " +
    "resolves the app once at registration and serves it statically.",
  boundary: "trigger",
  pair: "boundary.http.app.serve",
  inputs: {},
  // Registration-time config ports (like http.request): wire env/const values in.
  configInputs: {
    mount: value(z.string()),
    port: value(z.number().int().positive()),
  },
  outputs: { mount: value(z.string()) },
  config: z.object({
    /** URL prefix the assets are served under, e.g. "/admin". */
    mount: z.string().default("/"),
    /** Port to serve on (defaults to the host's default port, like routes). */
    port: z.number().int().positive().optional(),
    /** CORS policy for the asset routes. */
    cors: corsConfigSchema.optional(),
    requireAuth,
  }),
  execute: TRIGGER_EXECUTE,
};

export const httpAppServe = outgate({
  type: "boundary.http.app.serve",
  description:
    "App out-gate: receives the app object (filesystem + serving hints) the host mounts under " +
    "the paired boundary.http.app trigger's mount.",
  inputs: { app: { kind: "value", schema: appDescriptorSchema, required: true } },
  pair: "boundary.http.app",
});

// ────────────────────────────────────────────────────────────────────────────
// WebSocket
// ────────────────────────────────────────────────────────────────────────────

export const wsMessage: OpDefinition = {
  type: "boundary.ws.message",
  title: "boundary.ws.message",
  description:
    "Fires a run per inbound WS message. Outputs { message, connection, user, room? }. config.message " +
    "(JSON Schema — wire a core.schema.define node into the config port) validates inbound " +
    "messages; invalid ones are refused with an error reply instead of firing the run.",
  boundary: "trigger",
  pair: "boundary.ws.send",
  inputs: {},
  // Wire a schema node in to validate inbound messages (resolve phase).
  configInputs: { message: value(jsonSchema) },
  // The message output is typed by the declared schema, like http.request's body.
  // `validate`: the engine enforces it on seeded input for any entry path.
  outputs: (config: { message?: unknown }): Ports => ({
    message: config.message ? value(jsonSchemaToZod(config.message as never), { validate: true }) : value(),
    connection: value(connectionSchema),
    user: userPort(),
    room: value(z.string()),
  }),
  config: z.object({
    /** JSON Schema validating inbound messages (invalid → error reply, no run). */
    message: jsonSchema.optional(),
    requireAuth,
  }),
  execute: TRIGGER_EXECUTE,
};

export const wsOpen: OpDefinition = {
  type: "boundary.ws.open",
  title: "boundary.ws.open",
  description: "Connection-opened trigger. Outputs { connection, user }.",
  boundary: "trigger",
  pair: "boundary.ws.send",
  inputs: {},
  outputs: { connection: value(connectionSchema), user: userPort() },
  config: z.object({ requireAuth }),
  execute: TRIGGER_EXECUTE,
};

export const wsClose: OpDefinition = {
  type: "boundary.ws.close",
  title: "boundary.ws.close",
  description: "Connection-closed trigger. Outputs { connection, user, code?, reason? }.",
  boundary: "trigger",
  // The socket is already gone — the run's outcome is just its recorded result.
  pair: "boundary.return",
  inputs: {},
  outputs: {
    connection: value(connectionSchema),
    user: userPort(),
    code: value(z.number()),
    reason: value(z.string()),
  },
  // Same auth seam as open/message — a protected socket's close handler should
  // be declarable as protected too.
  config: z.object({ requireAuth }),
  execute: TRIGGER_EXECUTE,
};

export const wsSend = outgate({
  type: "boundary.ws.send",
  description: "Sends the run's result back on the connection (value, or `stream` for chunked sends).",
  inputs: { message: value(), stream: stream() },
  pair: "boundary.ws.message",
});

// ────────────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────────────

export const cli: OpDefinition = {
  type: "boundary.cli",
  title: "boundary.cli",
  description: "CLI process trigger. Outputs { args, parsed, stdin, env }.",
  boundary: "trigger",
  pair: "boundary.cli.exit",
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
  pair: "boundary.cli",
});

// ────────────────────────────────────────────────────────────────────────────
// Hook / Event
// ────────────────────────────────────────────────────────────────────────────

export const hookTrigger: OpDefinition = {
  type: "boundary.hook",
  title: "boundary.hook",
  description: "Filter-chain member (§8). config: { hook, priority? }. Outputs { payload }.",
  boundary: "trigger",
  pair: "boundary.hook.return",
  inputs: {},
  configInputs: { hook: value(z.string()), priority: value(z.number()) },
  outputs: { payload: value() },
  config: z.object({ hook: z.string(), priority: z.number().default(100) }),
  execute: TRIGGER_EXECUTE,
};

export const hookReturn = outgate({
  type: "boundary.hook.return",
  description: "Hook member out-gate: returns { payload, stop? } to thread/short-circuit the chain (§8).",
  inputs: { payload: required(), stop: value(z.boolean()) },
  reusable: false,
  pair: "boundary.hook",
});

export const eventTrigger: OpDefinition = {
  type: "boundary.event",
  title: "boundary.event",
  description:
    "Fire-and-forget subscriber (§8). config: { event }. Outputs { payload }. The emitter never " +
    "reads the result — pair with boundary.return to record an outcome on the run.",
  boundary: "trigger",
  pair: "boundary.return",
  inputs: {},
  configInputs: { event: value(z.string()) },
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
  httpApp,
  httpAppServe,
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
