/**
 * @pattern/mod-docs — the shipped workflows: thin `http.request → docs.* →
 * http.response` routes + the SPA app trio. `GET /docs/api/me` is always
 * open; everything else follows `requireAuth` (default: the
 * DOCS_REQUIRE_AUTH env switch — docs are public until you say otherwise).
 */

import type { Workflow } from "@pattern/core";
import type { ResolvedDocsOptions } from "./options.js";

interface RouteSpec {
  id: string;
  method: string;
  path: string;
  op: string;
}

function route(spec: RouteSpec, requireAuth?: unknown): Workflow {
  return {
    id: spec.id,
    name: `Docs · ${spec.method} ${spec.path}`,
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        config: { method: spec.method, path: spec.path, ...(requireAuth !== undefined ? { requireAuth } : {}) },
      },
      { id: "call", op: spec.op },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
    ],
    edges: [
      { from: { node: "in", port: "params" }, to: { node: "call", port: "params" } },
      { from: { node: "in", port: "query" }, to: { node: "call", port: "query" } },
      { from: { node: "in", port: "body" }, to: { node: "call", port: "body" } },
      { from: { node: "in", port: "headers" }, to: { node: "call", port: "headers" } },
      { from: { node: "in", port: "user" }, to: { node: "call", port: "user" } },
      { from: { node: "call", port: "status" }, to: { node: "out", port: "status" } },
      { from: { node: "call", port: "headers" }, to: { node: "out", port: "headers" } },
      { from: { node: "call", port: "body" }, to: { node: "out", port: "body" } },
    ],
  };
}

export function docsRouteWorkflows(opts: ResolvedDocsOptions): Workflow[] {
  const api = `${opts.mount}/api`;
  const gated: RouteSpec[] = [
    { id: "docs.route.manifest", method: "GET", path: `${api}/manifest`, op: "docs.manifest" },
    { id: "docs.route.page", method: "GET", path: `${api}/page`, op: "docs.page" },
    { id: "docs.route.raw", method: "GET", path: `${opts.mount}/raw`, op: "docs.raw" },
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
