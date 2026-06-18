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

import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { extname } from "node:path";
import { Readable } from "node:stream";
import {
  ANONYMOUS,
  AUTH_LOGIN_URL,
  jsonSchemaToZod,
  principalToUser,
  type Engine,
  type OpDefinition,
  type Principal,
  type RunResult,
  type Workflow,
  type z,
} from "@pattern/core";
import { filesystems, type Filesystem } from "./filesystem.js";

export interface HttpHostOptions {
  /**
   * Default port for routes that don't declare their own `port`. If omitted,
   * the host uses the `PORT` env var, then falls back to 3000.
   */
  defaultPort?: number;
  /** Interface to bind. Default all interfaces. */
  host?: string;
  /**
   * Max buffered request-body size in bytes (413 beyond it). Default 10 MiB.
   * Routes with `bodyMode: "stream"` are exempt — they never buffer.
   */
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY = 10 * 1024 * 1024;

/** Thrown by `readBody` when a buffered body exceeds the configured cap. */
class BodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`request body exceeds ${limit} bytes`);
  }
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
  paramsSchema?: z.ZodType;
  requireAuth?: unknown;
}

/** A static app mount derived from a `boundary.http.app` node (admin-spec P1). */
interface AppMount {
  /** Normalized URL prefix, no trailing slash ("" means root). */
  mount: string;
  port: number;
  filesystem: string;
  spaFallback: string;
  immutableAssets: boolean;
  cors?: CorsPolicy;
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

/** Normalize a mount prefix: leading slash, no trailing slash; root → "". */
function normalizeMount(mount: string): string {
  let m = mount.trim();
  if (!m.startsWith("/")) m = `/${m}`;
  m = m.replace(/\/+$/, "");
  return m; // "" for root
}

/** Is `pathname` at or under `mount` ("" matches everything)? */
function pathUnderMount(pathname: string, mount: string): boolean {
  if (mount === "") return true;
  return pathname === mount || pathname.startsWith(`${mount}/`);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** Content-type for a served asset, from its extension. */
function mimeType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function normalizeCors(cors: unknown): CorsPolicy | undefined {
  if (!cors) return undefined;
  if (cors === true) return { origin: "*", credentials: false };
  const c = cors as Partial<CorsPolicy>;
  return { origin: c.origin ?? "*", credentials: c.credentials ?? false, methods: c.methods, headers: c.headers, maxAge: c.maxAge, exposeHeaders: c.exposeHeaders };
}

export class HttpHost {
  private servers = new Map<number, Server>();
  /** Live sockets per server, so shutdown can force-close lingering connections
   *  (e.g. an open SSE stream that would otherwise keep `close()` pending). */
  private sockets = new Map<number, Set<Socket>>();
  private routes: CompiledRoute[] = [];
  private apps: AppMount[] = [];
  private unsubscribe?: () => void;
  private readonly defaultPort: number;
  private readonly serverListeners = new Set<(server: Server, port: number) => void>();

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
    this.warnIfUnenforceableAuth();
    this.unsubscribe = this.engine.onWorkflowsChanged(() => {
      void this.rebuild().catch((err) => console.error("[pattern] http rebuild failed:", err));
    });
    return { ports: [...this.servers.keys()], close: () => this.close() };
  }

  /**
   * Loud, honest signal: with NO auth provider installed, any route that
   * *declares* `requireAuth` can't be enforced (nobody can authenticate) — the
   * engine serves it open (advisory). Say so plainly at boot so it's never a
   * silent surprise. Add a provider and the same declarations are enforced.
   */
  private warnIfUnenforceableAuth(): void {
    if (this.engine.hasAuthProvider()) return;
    const gated = [...this.routes, ...this.apps].filter((r) => r.requireAuth).length;
    if (!gated) return;
    console.warn(
      `\n[pattern] ⚠ ${gated} route(s) declare requireAuth but NO auth provider is installed —\n` +
        `[pattern]   they are NOT enforced and serve UNAUTHENTICATED (anyone who can reach the\n` +
        `[pattern]   port has access). Add an auth provider (e.g. @pattern/mod-identity) to enforce\n` +
        `[pattern]   them. Routes without requireAuth are unaffected.\n`,
    );
  }

  /** Tail of the rebuild queue — see `rebuild()`. */
  private rebuilding: Promise<void> = Promise.resolve();

  /**
   * Scan workflows for `boundary.http.request` routes and reconcile servers.
   * Rebuilds are serialized: workflow-change events can fire in rapid bursts
   * (project load, admin batch deploys), and two interleaved reconciles would
   * race `openServer` on the same port into EADDRINUSE.
   */
  private rebuild(): Promise<void> {
    const next = this.rebuilding.then(() => this.rebuildNow());
    // The queue itself never rejects (errors surface to each caller via `next`).
    this.rebuilding = next.catch(() => {});
    return next;
  }

  private async rebuildNow(): Promise<void> {
    this.routes = this.scanRoutes();
    this.apps = await this.scanApps();
    const needed = new Set<number>([...this.routes.map((r) => r.port), ...this.apps.map((a) => a.port)]);

    for (const port of needed) {
      if (!this.servers.has(port)) await this.openServer(port);
    }
    for (const port of [...this.servers.keys()]) {
      if (!needed.has(port)) {
        await this.closeServer(port);
      }
    }
  }

  /** Close one server, destroying any lingering sockets first. */
  private closeServer(port: number): Promise<void> {
    const server = this.servers.get(port);
    if (!server) return Promise.resolve();
    for (const socket of this.sockets.get(port) ?? []) socket.destroy();
    this.sockets.delete(port);
    this.servers.delete(port);
    return new Promise<void>((r) => server.close(() => r()));
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
          paramsSchema: cfg.params ? jsonSchemaToZod(cfg.params as any, { coerce: true }) : undefined,
          requireAuth: cfg.requireAuth,
        });
      }
    }
    return routes;
  }

  /**
   * Scan workflows for `boundary.http.app` mounts (admin-spec P1). The trigger
   * declares the HTTP side (mount/port/cors/auth); the app itself is *resolved
   * by running the workflow once* — the run flows trigger → app op (e.g.
   * `core.app.static`, `admin.app`) → the `boundary.http.app.serve` out-gate,
   * whose captured `app` descriptor tells the host what to serve.
   */
  private async scanApps(): Promise<AppMount[]> {
    const apps: AppMount[] = [];
    for (const wf of this.engine.workflows.list()) {
      for (const node of wf.nodes) {
        const op = this.engine.ops.get(node.op);
        if (op?.type !== "boundary.http.app") continue;
        const cfg = parseConfig(op, node.config);
        const mount = normalizeMount(cfg.mount ?? "/");
        let app: { filesystem?: unknown; spaFallback?: unknown; immutableAssets?: unknown } | undefined;
        try {
          const result = await this.engine.runFrom(wf, node.id, { mount: cfg.mount ?? "/" }, ANONYMOUS);
          if (result.status === "error") throw result.error;
          const payload = firstOutgate(result, wf, "boundary.http.app.serve");
          app = (payload as { app?: typeof app } | undefined)?.app;
        } catch (err) {
          console.error(`[pattern] app workflow "${wf.id}" failed to resolve its app:`, err);
          continue;
        }
        if (!app || typeof app.filesystem !== "string") {
          console.error(`[pattern] app workflow "${wf.id}" produced no app descriptor — not mounted`);
          continue;
        }
        apps.push({
          mount,
          port: cfg.port ?? this.defaultPort,
          filesystem: app.filesystem,
          spaFallback: typeof app.spaFallback === "string" ? app.spaFallback : "index.html",
          immutableAssets: Boolean(app.immutableAssets),
          cors: normalizeCors(cfg.cors),
          requireAuth: cfg.requireAuth,
        });
      }
    }
    // Longest mount first, so "/admin/sub" wins over "/admin" / "/".
    apps.sort((a, b) => b.mount.length - a.mount.length);
    return apps;
  }

  /** The first app mount on `port` whose prefix matches `pathname`. */
  private matchApp(port: number, pathname: string): AppMount | undefined {
    return this.apps.find((a) => a.port === port && pathUnderMount(pathname, a.mount));
  }

  private openServer(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // The backstop: NOTHING a request does may become an unhandled rejection
      // (plain `node` kills the process on those). E.g. a streaming out-gate
      // whose producer fails AFTER the run settled errors the response stream
      // mid-write — that's a request-level failure, not a process-level one.
      const server = createServer((req, res) =>
        this.handle(req, res, port).catch((err) => {
          console.error("[pattern] request handler failed:", err);
          try {
            if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
          } catch {
            res.destroy();
          }
        }),
      );
      // Surface listen errors (e.g. EADDRINUSE) as a rejection instead of an
      // unhandled 'error' event that would crash the process.
      server.once("error", (err) => reject(err));
      // Track live sockets so close() can force them shut.
      const live = new Set<Socket>();
      this.sockets.set(port, live);
      server.on("connection", (socket: Socket) => {
        live.add(socket);
        socket.once("close", () => live.delete(socket));
      });
      server.listen(port, this.opts.host, () => {
        server.removeAllListeners("error");
        this.servers.set(port, server);
        for (const cb of this.serverListeners) cb(server, port);
        resolve();
      });
    });
  }

  /** The live http.Server for `port`, if open (e.g. to attach a WS host). */
  server(port: number): Server | undefined {
    return this.servers.get(port);
  }

  /**
   * Run `cb` for every open server, now and as new ports open (route
   * reconciliation opens/closes servers live) — the WS auto-wiring seam.
   */
  onServer(cb: (server: Server, port: number) => void): () => void {
    for (const [port, server] of this.servers) cb(server, port);
    this.serverListeners.add(cb);
    return () => this.serverListeners.delete(cb);
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
    // Build the URL from the real Host header (and forwarded proto), so the
    // trigger's `url` output carries the actual request origin — workflows that
    // build absolute links (magic-link callbacks) need the right host + port.
    const fwdProto = req.headers["x-forwarded-proto"];
    const proto = (Array.isArray(fwdProto) ? fwdProto[0] : fwdProto)?.split(",")[0]?.trim() || "http";
    const host = req.headers.host || `localhost:${port}`;
    const url = new URL(req.url ?? "/", `${proto}://${host}`);
    const method = (req.method ?? "GET").toUpperCase();

    // CORS preflight: any route on this port + path that declares CORS.
    if (method === "OPTIONS") {
      const cors =
        this.routes.find((r) => r.port === port && r.cors && r.regex.test(url.pathname))?.cors ??
        this.matchApp(port, url.pathname)?.cors;
      if (cors) return this.preflight(req, res, cors, port, url.pathname);
    }

    const matched = this.match(port, method, url.pathname);
    if (!matched) {
      // API routes take precedence; fall back to static app mounts (P1).
      const app = this.matchApp(port, url.pathname);
      if (app) return this.serveApp(req, res, app, url.pathname);
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

    // ── Validate params, query & body against the declared JSON Schemas (§7) ──
    const headersObj: Record<string, string> = {};
    headers.forEach((v, k) => (headersObj[k] = v));
    let routeParams: unknown = params;
    if (route.paramsSchema) {
      const parsed = route.paramsSchema.safeParse(routeParams);
      if (!parsed.success) return badRequest(res, "params", parsed.error);
      routeParams = parsed.data;
    }
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
      try {
        body = await readBody(req, headers.get("content-type"), this.opts.maxBodyBytes ?? DEFAULT_MAX_BODY);
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          res.writeHead(413, { "content-type": "application/json" }).end(JSON.stringify({ error: err.message }));
          return;
        }
        throw err;
      }
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
      cookies: parseCookies(headersObj.cookie),
      query,
      params: routeParams,
      body,
      // Seeds the trigger's `user` output port (§9): the resolved principal
      // flattened for wiring, null when anonymous.
      user: principalToUser(principal),
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

  /** Serve a static asset (or SPA fallback) for an app mount (admin-spec P1). */
  private async serveApp(
    req: IncomingMessage,
    res: ServerResponse,
    app: AppMount,
    pathname: string,
  ): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
      return;
    }
    if (app.cors) applyCors(res, app.cors, req.headers.origin);

    // Auth (§9): the app mount may require it, like any route.
    if (app.requireAuth) {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }
      const principal = await this.engine.authenticate({ headers, raw: req });
      const auth = this.engine.authorize(principal, app.requireAuth as any);
      if (!auth.ok) {
        // A browser asking for HTML gets bounced to the advertised login page
        // (§9) — the identity mod registers AUTH_LOGIN_URL; fetch/XHR callers
        // still get the bare 401 and handle it client-side.
        const loginUrl = this.engine.service<string>(AUTH_LOGIN_URL);
        const accept = String(req.headers["accept"] ?? "");
        if (loginUrl && accept.includes("text/html")) {
          const next = encodeURIComponent(req.url ?? "/");
          res.writeHead(302, { location: `${loginUrl}?next=${next}` }).end();
          return;
        }
        res.writeHead(401, { "content-type": "text/plain" }).end(`Unauthorized: ${auth.reason}`);
        return;
      }
    }

    const fs: Filesystem | undefined = filesystems(this.engine).get(app.filesystem);
    if (!fs) {
      res.writeHead(500, { "content-type": "text/plain" }).end(`filesystem "${app.filesystem}" not registered`);
      return;
    }

    let rel = pathname.slice(app.mount.length).replace(/^\/+/, "");
    if (rel === "") rel = app.spaFallback || "index.html";

    const readIfExists = async (p: string): Promise<Uint8Array | null> =>
      (await fs.fileExists(p)) ? fs.readToUint8Array(p) : null;

    let bytes = await readIfExists(rel);
    let servedFallback = false;
    if (bytes == null && app.spaFallback) {
      // Client-side routing: serve the fallback for HTML navigations only.
      const accept = String(req.headers["accept"] ?? "");
      if (accept.includes("text/html")) {
        bytes = await readIfExists(app.spaFallback);
        servedFallback = true;
        rel = app.spaFallback;
      }
    }
    if (bytes == null) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
      return;
    }

    const headers: Record<string, string> = { "content-type": mimeType(rel) };
    const isHtmlEntry = servedFallback || rel === app.spaFallback;
    if (app.immutableAssets && !isHtmlEntry) headers["cache-control"] = "public, max-age=31536000, immutable";
    else if (isHtmlEntry) headers["cache-control"] = "no-cache";
    res.writeHead(200, headers);
    if (method === "HEAD") return void res.end();
    res.end(Buffer.from(bytes));
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
    await Promise.all([...this.servers.keys()].map((port) => this.closeServer(port)));
    this.servers.clear();
    this.sockets.clear();
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
  // With an array allowlist, a non-matching (or absent) request origin gets NO
  // Access-Control-Allow-Origin header at all — echoing any allowlisted value
  // back to an unlisted origin would effectively open CORS to everyone.
  const origin =
    cors.origin === "*"
      ? "*"
      : Array.isArray(cors.origin)
        ? reqOrigin && cors.origin.includes(reqOrigin)
          ? reqOrigin
          : undefined
        : cors.origin;
  if (origin !== undefined) res.setHeader("Access-Control-Allow-Origin", origin);
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

async function readBody(req: IncomingMessage, contentType: string | null, maxBytes = DEFAULT_MAX_BODY): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > maxBytes) {
      req.destroy(); // stop the client from streaming the rest into memory
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(c as Buffer);
  }
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
  // Browser form posts → a plain object, so a workflow can decompose the fields
  // (core.object.extract) just like a JSON body. Ops never parse forms.
  if (ct.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(buf.toString("utf8")).entries());
  }
  if (ct.startsWith("text/") || ct === "") return buf.toString("utf8");
  return new Uint8Array(buf);
}

interface ResponsePayload {
  mode?: "buffered" | "sse" | "chunked";
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  stream?: ReadableStream<unknown>;
  cookies?: Record<string, unknown>;
  redirect?: string;
}

/** Parse a request `Cookie` header into a name→value record (network-IN). */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[name] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/** Serialize one Set-Cookie value from `{ name: value | { value, … } }` (network-OUT). */
function serializeCookie(name: string, spec: unknown): string {
  if (spec === null || spec === undefined) return `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  if (typeof spec !== "object") return `${name}=${encodeURIComponent(String(spec))}; Path=/; SameSite=Lax; HttpOnly`;
  const o = spec as { value?: unknown; maxAge?: number; path?: string; domain?: string; expires?: string; sameSite?: string; httpOnly?: boolean; secure?: boolean };
  const parts = [`${name}=${encodeURIComponent(String(o.value ?? ""))}`, `Path=${o.path ?? "/"}`];
  if (o.maxAge != null) parts.push(`Max-Age=${o.maxAge}`);
  if (o.expires) parts.push(`Expires=${o.expires}`);
  if (o.domain) parts.push(`Domain=${o.domain}`);
  parts.push(`SameSite=${o.sameSite ?? "Lax"}`);
  if (o.httpOnly !== false) parts.push("HttpOnly");
  if (o.secure) parts.push("Secure");
  return parts.join("; ");
}

async function writeResponse(res: ServerResponse, payload: ResponsePayload): Promise<void> {
  const mode = payload.mode ?? "buffered";
  // A redirect is just 302 + Location (status overridable for 301/307/308).
  const redirecting = typeof payload.redirect === "string" && payload.redirect.length > 0;
  const status = payload.status ?? (redirecting ? 302 : 200);
  const headers: Record<string, string | string[]> = { ...(payload.headers ?? {}) };
  if (redirecting) headers.location = payload.redirect as string;
  if (payload.cookies && typeof payload.cookies === "object") {
    const set = Object.entries(payload.cookies).map(([n, s]) => serializeCookie(n, s));
    if (set.length) headers["set-cookie"] = set;
  }

  if (mode === "sse" || mode === "chunked") {
    const sse = mode === "sse";
    res.writeHead(status, sse
      ? { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...headers }
      : { "transfer-encoding": "chunked", ...headers });
    const src = payload.stream ?? (payload.body instanceof ReadableStream ? payload.body : undefined);
    if (src) {
      try {
        for await (const chunk of streamIter(src)) {
          if (sse) res.write(`data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`);
          else res.write(chunk instanceof Uint8Array ? chunk : typeof chunk === "string" ? chunk : JSON.stringify(chunk));
        }
      } catch (err) {
        // The producer failed mid-stream (headers are long gone) — end the
        // response; consumers recover from their source of truth.
        console.error("[pattern] response stream errored mid-flight:", err instanceof Error ? err.message : err);
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
