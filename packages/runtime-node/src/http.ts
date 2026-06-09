/**
 * @pattern/runtime-node — HTTP host (§6, §7).
 *
 * Routing is **declarative**: the host derives its routes from the
 * `boundary.http.request` nodes of the workflows registered on the engine. Each
 * node's config carries the method, path, port, CORS policy, and JSON-Schema
 * validation for body/query — there is no programmatic route table. When
 * workflows change at runtime (e.g. loaded/updated from a DB), the host
 * re-derives its routes live, opening/closing servers per declared port.
 *
 * Response modes: `buffered`, `sse` (Server-Sent Events), `chunked`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import {
  jsonSchemaToZod,
  type Engine,
  type OpDefinition,
  type Principal,
  type RunResult,
  type Workflow,
  type z,
} from "@pattern/core";

export interface HttpHostOptions {
  /**
   * Default port for routes that don't declare their own `port`. If omitted,
   * the host uses the `PORT` env var, then falls back to 3000.
   */
  defaultPort?: number;
  /** Interface to bind. Default all interfaces. */
  host?: string;
}

interface CorsPolicy {
  origin: string | string[];
  methods?: string[];
  headers?: string[];
  credentials: boolean;
  maxAge?: number;
  exposeHeaders?: string[];
}

interface CompiledRoute {
  method: string; // upper-case, or "ANY"
  path: string;
  port: number;
  regex: RegExp;
  paramNames: string[];
  workflowId: string;
  trigger: string;
  bodyMode: "buffered" | "stream";
  cors?: CorsPolicy;
  bodySchema?: z.ZodType;
  querySchema?: z.ZodType;
  requireAuth?: unknown;
}

/** Read a positive integer port from the PORT env var, if valid. */
function envPort(): number | undefined {
  const raw = process.env.PORT;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function compilePath(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  // Escape regex specials (`:` is not one, so params survive as `:name`), then
  // turn each `:param` segment into a capture group.
  const pattern = path
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
  return { regex: new RegExp(`^${pattern}/?$`), paramNames };
}

function normalizeCors(cors: unknown): CorsPolicy | undefined {
  if (!cors) return undefined;
  if (cors === true) return { origin: "*", credentials: false };
  const c = cors as Partial<CorsPolicy>;
  return { origin: c.origin ?? "*", credentials: c.credentials ?? false, methods: c.methods, headers: c.headers, maxAge: c.maxAge, exposeHeaders: c.exposeHeaders };
}

export class HttpHost {
  private servers = new Map<number, Server>();
  private routes: CompiledRoute[] = [];
  private unsubscribe?: () => void;
  private readonly defaultPort: number;

  constructor(
    private readonly engine: Engine,
    private readonly opts: HttpHostOptions = {},
  ) {
    // Port resolution for a route: its op `config.port`, else this default.
    // Default = explicit `defaultPort` (e.g. from pattern.config.json http.port),
    // else the PORT env var, else 3000.
    this.defaultPort = opts.defaultPort ?? envPort() ?? 3000;
  }

  /** Derive routes from registered workflows, open servers, and watch for changes. */
  async start(): Promise<{ ports: number[]; close: () => Promise<void> }> {
    await this.rebuild();
    this.unsubscribe = this.engine.onWorkflowsChanged(() => {
      void this.rebuild().catch((err) => console.error("[pattern] http rebuild failed:", err));
    });
    return { ports: [...this.servers.keys()], close: () => this.close() };
  }

  /** Scan workflows for `boundary.http.request` routes and reconcile servers. */
  private async rebuild(): Promise<void> {
    this.routes = this.scanRoutes();
    const needed = new Set(this.routes.map((r) => r.port));

    for (const port of needed) {
      if (!this.servers.has(port)) await this.openServer(port);
    }
    for (const port of [...this.servers.keys()]) {
      if (!needed.has(port)) {
        await new Promise<void>((r) => this.servers.get(port)!.close(() => r()));
        this.servers.delete(port);
      }
    }
  }

  private scanRoutes(): CompiledRoute[] {
    const routes: CompiledRoute[] = [];
    for (const wf of this.engine.workflows.list()) {
      for (const node of wf.nodes) {
        const op = this.engine.ops.get(node.op);
        if (op?.type !== "boundary.http.request") continue;
        const cfg = parseConfig(op, node.config);
        if (!cfg.path) continue; // not routable without a path
        const { regex, paramNames } = compilePath(cfg.path);
        routes.push({
          method: String(cfg.method ?? "GET").toUpperCase(),
          path: cfg.path,
          port: cfg.port ?? this.defaultPort,
          regex,
          paramNames,
          workflowId: wf.id,
          trigger: node.id,
          bodyMode: cfg.bodyMode === "stream" ? "stream" : "buffered",
          cors: normalizeCors(cfg.cors),
          bodySchema: cfg.body ? jsonSchemaToZod(cfg.body as any) : undefined,
          querySchema: cfg.query ? jsonSchemaToZod(cfg.query as any, { coerce: true }) : undefined,
          requireAuth: cfg.requireAuth,
        });
      }
    }
    return routes;
  }

  private openServer(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => void this.handle(req, res, port));
      // Surface listen errors (e.g. EADDRINUSE) as a rejection instead of an
      // unhandled 'error' event that would crash the process.
      server.once("error", (err) => reject(err));
      server.listen(port, this.opts.host, () => {
        server.removeAllListeners("error");
        this.servers.set(port, server);
        resolve();
      });
    });
  }

  private match(port: number, method: string, pathname: string): { route: CompiledRoute; params: Record<string, string> } | undefined {
    for (const route of this.routes) {
      if (route.port !== port) continue;
      if (route.method !== "ANY" && route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1] ?? "")));
      return { route, params };
    }
    return undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = (req.method ?? "GET").toUpperCase();

    // CORS preflight: any route on this port + path that declares CORS.
    if (method === "OPTIONS") {
      const cors = this.routes.find((r) => r.port === port && r.cors && r.regex.test(url.pathname))?.cors;
      if (cors) return this.preflight(req, res, cors, port, url.pathname);
    }

    const matched = this.match(port, method, url.pathname);
    if (!matched) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
      return;
    }
    const { route, params } = matched;
    if (route.cors) applyCors(res, route.cors, req.headers.origin);

    const workflow = this.engine.workflows.get(route.workflowId);
    if (!workflow) {
      res.writeHead(500).end("workflow not registered");
      return;
    }

    // ── Auth (§9) ──
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(", "));
    }
    const principal: Principal = await this.engine.authenticate({ headers, raw: req });
    const auth = this.engine.authorize(principal, route.requireAuth as any);
    if (!auth.ok) {
      res.writeHead(401, { "content-type": "text/plain" }).end(`Unauthorized: ${auth.reason}`);
      return;
    }

    // ── Validate query & body against the declared JSON Schemas (§7) ──
    const headersObj: Record<string, string> = {};
    headers.forEach((v, k) => (headersObj[k] = v));
    let query: unknown = Object.fromEntries(url.searchParams.entries());
    if (route.querySchema) {
      const parsed = route.querySchema.safeParse(query);
      if (!parsed.success) return badRequest(res, "query", parsed.error);
      query = parsed.data;
    }

    let body: unknown;
    if (route.bodyMode === "stream") {
      body = Readable.toWeb(req);
    } else {
      body = await readBody(req, headers.get("content-type"));
      if (route.bodySchema) {
        const parsed = route.bodySchema.safeParse(body);
        if (!parsed.success) return badRequest(res, "body", parsed.error);
        body = parsed.data;
      }
    }

    const input: Record<string, unknown> = {
      method,
      url: url.toString(),
      path: url.pathname,
      headers: headersObj,
      query,
      params,
      body,
    };

    let result: RunResult;
    try {
      result = await this.engine.runFrom(workflow, route.trigger, input, principal);
    } catch (err) {
      return writeError(res, err);
    }
    if (result.status === "error") return writeError(res, result.error);

    const payload = firstOutgate(result, workflow, "boundary.http.response");
    if (!payload) {
      res.writeHead(204).end();
      return;
    }
    await writeResponse(res, payload);
  }

  private preflight(req: IncomingMessage, res: ServerResponse, cors: CorsPolicy, port: number, pathname: string): void {
    const methods = cors.methods ?? collectMethods(this.routes, port, pathname);
    applyCors(res, cors, req.headers.origin);
    res.setHeader("Access-Control-Allow-Methods", methods.join(", "));
    res.setHeader(
      "Access-Control-Allow-Headers",
      cors.headers?.join(", ") ?? req.headers["access-control-request-headers"] ?? "*",
    );
    if (cors.maxAge != null) res.setHeader("Access-Control-Max-Age", String(cors.maxAge));
    res.writeHead(204).end();
  }

  async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await Promise.all([...this.servers.values()].map((s) => new Promise<void>((r) => s.close(() => r()))));
    this.servers.clear();
  }
}

// ── helpers ──

function parseConfig(op: OpDefinition, config: unknown): any {
  return op.config ? op.config.parse(config ?? {}) : (config ?? {});
}

function collectMethods(routes: CompiledRoute[], port: number, pathname: string): string[] {
  const methods = new Set<string>();
  for (const r of routes) if (r.port === port && r.regex.test(pathname)) methods.add(r.method);
  methods.add("OPTIONS");
  return [...methods];
}

function applyCors(res: ServerResponse, cors: CorsPolicy, reqOrigin?: string): void {
  const origin =
    cors.origin === "*"
      ? "*"
      : Array.isArray(cors.origin)
        ? reqOrigin && cors.origin.includes(reqOrigin)
          ? reqOrigin
          : cors.origin[0] ?? "*"
        : cors.origin;
  res.setHeader("Access-Control-Allow-Origin", origin);
  if (origin !== "*") res.setHeader("Vary", "Origin");
  if (cors.credentials) res.setHeader("Access-Control-Allow-Credentials", "true");
  if (cors.exposeHeaders?.length) res.setHeader("Access-Control-Expose-Headers", cors.exposeHeaders.join(", "));
}

function badRequest(res: ServerResponse, where: string, error: z.ZodError): void {
  res.writeHead(400, { "content-type": "application/json" }).end(
    JSON.stringify({
      error: `invalid ${where}`,
      issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    }),
  );
}

async function readBody(req: IncomingMessage, contentType: string | null): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  if (buf.length === 0) return undefined;
  const ct = contentType ?? "";
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch {
      return buf.toString("utf8");
    }
  }
  if (ct.startsWith("text/") || ct.includes("urlencoded") || ct === "") return buf.toString("utf8");
  return new Uint8Array(buf);
}

interface ResponsePayload {
  mode?: "buffered" | "sse" | "chunked";
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  stream?: ReadableStream<unknown>;
}

async function writeResponse(res: ServerResponse, payload: ResponsePayload): Promise<void> {
  const mode = payload.mode ?? "buffered";
  const status = payload.status ?? 200;
  const headers = { ...(payload.headers ?? {}) };

  if (mode === "sse" || mode === "chunked") {
    const sse = mode === "sse";
    res.writeHead(status, sse
      ? { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...headers }
      : { "transfer-encoding": "chunked", ...headers });
    const src = payload.stream ?? (payload.body instanceof ReadableStream ? payload.body : undefined);
    if (src) {
      for await (const chunk of streamIter(src)) {
        if (sse) res.write(`data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`);
        else res.write(chunk instanceof Uint8Array ? chunk : typeof chunk === "string" ? chunk : JSON.stringify(chunk));
      }
    }
    res.end();
    return;
  }

  const body = payload.body;
  if (body == null) res.writeHead(status, headers).end();
  else if (typeof body === "string") res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers }).end(body);
  else if (body instanceof Uint8Array) res.writeHead(status, headers).end(Buffer.from(body));
  else res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
}

async function* streamIter(stream: ReadableStream<unknown>): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function writeError(res: ServerResponse, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

function firstOutgate(result: RunResult, workflow: Workflow, opType: string): ResponsePayload | undefined {
  for (const [nodeId, payload] of Object.entries(result.outputs)) {
    if (workflow.nodes.find((n) => n.id === nodeId)?.op === opType) return payload as ResponsePayload;
  }
  return Object.values(result.outputs)[0] as ResponsePayload | undefined;
}

/** Create an HTTP host that derives its routes from the engine's workflows. */
export function createHttpHost(engine: Engine, opts?: HttpHostOptions): HttpHost {
  return new HttpHost(engine, opts);
}
