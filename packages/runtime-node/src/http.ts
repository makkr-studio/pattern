/**
 * @pattern/runtime-node — HTTP host (§6, §7).
 *
 * Binds Node's `node:http` server to `boundary.http.request` triggers and writes
 * `boundary.http.response` out-gate results. Supports the three response modes:
 *
 *  - buffered — write the whole body once.
 *  - sse      — Server-Sent Events; flush each stream chunk as `data: …`.
 *  - chunked  — chunked transfer; flush each stream chunk raw.
 *
 * This is the only place HTTP-specific code lives; core stays runtime-neutral.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Engine, Principal, RunResult, Workflow } from "@pattern/core";

export interface HttpRoute {
  /** HTTP method to match (any if omitted). */
  method?: string;
  /** Path pattern with `:param` segments, e.g. "/users/:id". */
  path: string;
  /** Workflow (or its registered id) to run. */
  workflow: Workflow | string;
  /** The `boundary.http.request` trigger node id (inferred if omitted). */
  trigger?: string;
}

export interface HttpHostOptions {
  routes?: HttpRoute[];
  /** Fallback when no route matches. Defaults to 404. */
  notFound?: (req: IncomingMessage, res: ServerResponse) => void;
}

interface CompiledRoute extends HttpRoute {
  regex: RegExp;
  paramNames: string[];
}

/** Compile "/users/:id" into a matcher capturing named params. */
function compile(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const pattern = path
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\:([A-Za-z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
  return { regex: new RegExp(`^${pattern}/?$`), paramNames };
}

export class HttpHost {
  readonly server: Server;
  private routes: CompiledRoute[] = [];

  constructor(
    private readonly engine: Engine,
    private readonly opts: HttpHostOptions = {},
  ) {
    for (const r of opts.routes ?? []) this.addRoute(r);
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  addRoute(route: HttpRoute): this {
    this.routes.push({ ...route, ...compile(route.path) });
    return this;
  }

  listen(port: number, host?: string): Promise<{ port: number; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      this.server.listen(port, host, () => {
        const addr = this.server.address();
        const actual = typeof addr === "object" && addr ? addr.port : port;
        resolve({
          port: actual,
          close: () => new Promise<void>((r) => this.server.close(() => r())),
        });
      });
    });
  }

  private match(req: IncomingMessage): { route: CompiledRoute; params: Record<string, string> } | undefined {
    const url = new URL(req.url ?? "/", "http://localhost");
    for (const route of this.routes) {
      if (route.method && route.method.toUpperCase() !== req.method) continue;
      const m = route.regex.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1] ?? "")));
      return { route, params };
    }
    return undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const matched = this.match(req);
    if (!matched) {
      if (this.opts.notFound) return this.opts.notFound(req, res);
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not Found");
      return;
    }
    const { route, params } = matched;

    const workflow =
      typeof route.workflow === "string" ? this.engine.workflows.get(route.workflow) : route.workflow;
    if (!workflow) {
      res.writeHead(500).end("workflow not registered");
      return;
    }
    const triggerId = route.trigger ?? findTrigger(workflow, "boundary.http.request");
    if (!triggerId) {
      res.writeHead(500).end("no boundary.http.request trigger");
      return;
    }
    const triggerNode = workflow.nodes.find((n) => n.id === triggerId);
    const bodyMode = (triggerNode?.config as { bodyMode?: string } | undefined)?.bodyMode ?? "buffered";

    // ── Auth (§9): resolve principal, enforce requireAuth before running. ──
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(", "));
    }
    const principal: Principal = await this.engine.authenticate({ headers, raw: req });
    const requireAuth = (triggerNode?.config as { requireAuth?: unknown } | undefined)?.requireAuth;
    const auth = this.engine.authorize(principal, requireAuth as any);
    if (!auth.ok) {
      res.writeHead(401, { "content-type": "text/plain" }).end(`Unauthorized: ${auth.reason}`);
      return;
    }

    // ── Build the trigger input. ──
    const url = new URL(req.url ?? "/", "http://localhost");
    const headersObj: Record<string, string> = {};
    headers.forEach((v, k) => (headersObj[k] = v));
    const input: Record<string, unknown> = {
      method: req.method ?? "GET",
      url: url.toString(),
      path: url.pathname,
      headers: headersObj,
      query: Object.fromEntries(url.searchParams.entries()),
      params,
      body: bodyMode === "stream" ? Readable.toWeb(req) : await readBody(req, headers.get("content-type")),
    };

    // ── Run and write the out-gate result. ──
    let result: RunResult;
    try {
      result = await this.engine.runFrom(workflow, triggerId, input, principal);
    } catch (err) {
      writeError(res, err);
      return;
    }
    if (result.status === "error") {
      writeError(res, result.error);
      return;
    }

    const payload = firstOutgate(result, workflow, "boundary.http.response");
    if (!payload) {
      res.writeHead(204).end();
      return;
    }
    await writeResponse(res, payload);
  }
}

/** Read & parse a request body (json/text/bytes) for buffered mode. */
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

  if (mode === "sse") {
    res.writeHead(status, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...headers,
    });
    const src = payload.stream ?? (payload.body instanceof ReadableStream ? payload.body : undefined);
    if (src) {
      for await (const chunk of streamIter(src)) {
        res.write(`data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`);
      }
    }
    res.end();
    return;
  }

  if (mode === "chunked") {
    res.writeHead(status, { "transfer-encoding": "chunked", ...headers });
    const src = payload.stream ?? (payload.body instanceof ReadableStream ? payload.body : undefined);
    if (src) {
      for await (const chunk of streamIter(src)) {
        res.write(chunk instanceof Uint8Array ? chunk : typeof chunk === "string" ? chunk : JSON.stringify(chunk));
      }
    }
    res.end();
    return;
  }

  // buffered
  const body = payload.body;
  if (body == null) {
    res.writeHead(status, headers).end();
  } else if (typeof body === "string") {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers }).end(body);
  } else if (body instanceof Uint8Array) {
    res.writeHead(status, headers).end(Buffer.from(body));
  } else {
    res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
  }
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

function findTrigger(workflow: Workflow, opType: string): string | undefined {
  return workflow.nodes.find((n) => n.op === opType)?.id;
}

function firstOutgate(result: RunResult, workflow: Workflow, opType: string): ResponsePayload | undefined {
  for (const [nodeId, payload] of Object.entries(result.outputs)) {
    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (node?.op === opType) return payload as ResponsePayload;
  }
  // Fall back to any single out-gate.
  const values = Object.values(result.outputs);
  return values[0] as ResponsePayload | undefined;
}

/** Create and return an HTTP host. */
export function createHttpHost(engine: Engine, opts?: HttpHostOptions): HttpHost {
  return new HttpHost(engine, opts);
}
