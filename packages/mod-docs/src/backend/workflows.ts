/**
 * @pattern/mod-docs — the shipped workflows: thin `http.request → docs.* →
 * http.response` routes + the SPA app trio. `GET /docs/api/me` is always
 * open; everything else follows `requireAuth` (default: the
 * DOCS_REQUIRE_AUTH env switch — docs are public until you say otherwise).
 */

import type { Workflow } from "@pattern/core";
import { docsOpRoutes, type DocsInSpec } from "./ops.js";
import type { ResolvedDocsOptions } from "./options.js";

interface RouteSpec {
  id: string;
  method: string;
  path: string;
  op: string;
}

/**
 * A route: decompose the request (query → discrete op ports, `user` straight
 * through), run the pure op, map its outcome to a status with
 * `boundary.http.status`, and set the content-type for markdown routes. The op
 * never touches HTTP.
 */
function route(spec: RouteSpec, requireAuth?: unknown): Workflow {
  const io = docsOpRoutes[spec.op];
  if (!io) throw new Error(`docs route "${spec.id}": no I/O for op "${spec.op}"`);
  const entries = Object.entries(io.in);
  const groups: Record<string, Array<[string, DocsInSpec]>> = { query: [], params: [] };
  const userPorts: string[] = [];
  for (const [name, spec2] of entries) {
    if (spec2.src === "user") userPorts.push(name);
    else groups[spec2.src]!.push([name, spec2]);
  }

  const nodes: Workflow["nodes"] = [
    { id: "in", op: "boundary.http.request", config: { method: spec.method, path: spec.path, ...(requireAuth !== undefined ? { requireAuth } : {}) } },
    { id: "call", op: spec.op },
    { id: "status", op: "boundary.http.status" },
    { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
  ];
  const edges: Workflow["edges"] = [];

  let wired = false;
  for (const src of ["query", "params"] as const) {
    const ports = groups[src]!;
    if (!ports.length) continue;
    wired = true;
    const ex = `ex_${src}`;
    nodes.push({ id: ex, op: "core.object.extract", config: { keys: ports.map(([n]) => n) } });
    edges.push({ from: { node: "in", port: src }, to: { node: ex, port: "object" } });
    for (const [name] of ports) edges.push({ from: { node: ex, port: name }, to: { node: "call", port: name } });
  }
  for (const p of userPorts) {
    wired = true;
    edges.push({ from: { node: "in", port: "user" }, to: { node: "call", port: p } });
  }
  if (!wired) edges.push({ from: { node: "in", port: "out" }, to: { node: "call", port: "in" } });

  edges.push({ from: { node: "call", port: io.out }, to: { node: "status", port: "result" } });
  edges.push({ from: { node: "status", port: "status" }, to: { node: "out", port: "status" } });
  edges.push({ from: { node: "status", port: "body" }, to: { node: "out", port: "body" } });

  if (io.contentType) {
    nodes.push({ id: "ct", op: "core.const.object", config: { value: { "content-type": io.contentType } } });
    edges.push({ from: { node: "ct", port: "out" }, to: { node: "out", port: "headers" } });
  }

  return { id: spec.id, name: `Docs · ${spec.method} ${spec.path}`, source: "code", nodes, edges };
}

export function docsRouteWorkflows(opts: ResolvedDocsOptions): Workflow[] {
  const api = `${opts.mount}/api`;
  const gated: RouteSpec[] = [
    { id: "docs.route.manifest", method: "GET", path: `${api}/manifest`, op: "docs.manifest" },
    { id: "docs.route.page", method: "GET", path: `${api}/page`, op: "docs.page" },
    { id: "docs.route.raw", method: "GET", path: `${opts.mount}/raw`, op: "docs.raw" },
    { id: "docs.route.ops", method: "GET", path: `${api}/ops`, op: "docs.ops.list" },
    { id: "docs.route.op", method: "GET", path: `${api}/op`, op: "docs.ops.get" },
    { id: "docs.route.mods", method: "GET", path: `${api}/mods`, op: "docs.mods.list" },
    { id: "docs.route.search", method: "GET", path: `${api}/search-index`, op: "docs.search.index" },
    // Routes beat app mounts in the host, so this wins over the /docs SPA.
    { id: "docs.route.llms", method: "GET", path: `${opts.mount}/llms.txt`, op: "docs.llms" },
  ];
  return [
    // /me is ALWAYS open — it answers "who am I / is auth required?" so the
    // SPA can render its own sign-in instead of bouncing off a raw 401.
    route({ id: "docs.route.me", method: "GET", path: `${api}/me`, op: "docs.me" }),
    ...gated.map((s) => route(s, opts.requireAuth)),
  ];
}

export function spaWorkflow(mount: string): Workflow {
  return {
    id: "docs.spa",
    name: "Docs · SPA",
    source: "code",
    nodes: [
      { id: "mount", op: "boundary.http.app", config: { mount }, ui: { x: 60, y: 60, pair: "serve" } },
      { id: "docs", op: "docs.app", ui: { x: 340, y: 60 } },
      { id: "serve", op: "boundary.http.app.serve", ui: { x: 620, y: 60, pair: "mount" } },
    ],
    edges: [
      { from: { node: "mount", port: "out" }, to: { node: "docs", port: "in" } },
      { from: { node: "docs", port: "app" }, to: { node: "serve", port: "app" } },
    ],
  };
}
