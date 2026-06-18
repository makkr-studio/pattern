/**
 * @pattern/mod-identity — endpoint workflows.
 *
 * The auth surface IS a set of Pattern workflows (same self-reflection as the
 * admin API): each route is `http.request → identity.<op> → http.response`.
 * HTTP ops get the full status/headers/body wiring (cookies and redirects are
 * the result); JSON ops wire a single body. All of these are public — the
 * pages must be reachable logged-out, and the privileged surface is ops-only
 * (admin-stamped invoke), not routes.
 */

import type { Workflow } from "@pattern/core";
import { authOpRoutes } from "./ops.js";

interface EndpointSpec {
  id: string;
  method: string;
  path: string;
  op: string;
  /**
   * "http" — an auth-page/redirect op where Set-Cookie + Location ARE the result
   * (the documented exception): wires headers in, status/headers/body out.
   * "json" — a PURE op: its named output → boundary.http.status → response.
   */
  shape: "http" | "json";
  /** For json routes: the op's named output port, and which query keys it reads. */
  out?: string;
  query?: string[];
}

function endpoint(spec: EndpointSpec): Workflow {
  if (spec.shape === "http") {
    // Auth pages + redirects: decompose the request into the PURE op's discrete
    // ports (query/body fields + the user-agent), run it, and wire its
    // { body, redirect, cookies, status } onto the out-gate. The op never sees
    // HTTP — Set-Cookie / Location are produced from its domain outputs here.
    const io = authOpRoutes[spec.op];
    if (!io) throw new Error(`identity route "${spec.id}": no auth I/O for op "${spec.op}"`);
    const nodes: Workflow["nodes"] = [
      { id: "in", op: "boundary.http.request", config: { method: spec.method, path: spec.path } },
      { id: "call", op: spec.op },
      { id: "ct", op: "core.const.object", config: { value: { "content-type": "text/html; charset=utf-8" } } },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
    ];
    const edges: Workflow["edges"] = [];
    let wired = false;
    if (io.query.length) {
      wired = true;
      nodes.push({ id: "ex_query", op: "core.object.extract", config: { keys: io.query } });
      edges.push({ from: { node: "in", port: "query" }, to: { node: "ex_query", port: "object" } });
      for (const k of io.query) edges.push({ from: { node: "ex_query", port: k }, to: { node: "call", port: k } });
    }
    if (io.body.length) {
      wired = true;
      nodes.push({ id: "ex_body", op: "core.object.extract", config: { keys: io.body } });
      edges.push({ from: { node: "in", port: "body" }, to: { node: "ex_body", port: "object" } });
      for (const k of io.body) edges.push({ from: { node: "ex_body", port: k }, to: { node: "call", port: k } });
    }
    if (io.userAgent) {
      wired = true;
      nodes.push({ id: "ex_ua", op: "core.object.get", config: { path: "user-agent" } });
      edges.push({ from: { node: "in", port: "headers" }, to: { node: "ex_ua", port: "object" } });
      edges.push({ from: { node: "ex_ua", port: "out" }, to: { node: "call", port: "userAgent" } });
    }
    if (!wired) edges.push({ from: { node: "in", port: "out" }, to: { node: "call", port: "in" } });
    edges.push({ from: { node: "call", port: "body" }, to: { node: "out", port: "body" } });
    edges.push({ from: { node: "call", port: "redirect" }, to: { node: "out", port: "redirect" } });
    edges.push({ from: { node: "call", port: "cookies" }, to: { node: "out", port: "cookies" } });
    edges.push({ from: { node: "call", port: "status" }, to: { node: "out", port: "status" } });
    edges.push({ from: { node: "ct", port: "out" }, to: { node: "out", port: "headers" } });
    return { id: spec.id, name: `Identity · ${spec.method} ${spec.path}`, source: "code", nodes, edges };
  }

  // JSON route: decompose the query into the pure op's ports, run it, map its
  // outcome with boundary.http.status (the op never sees HTTP).
  const out = spec.out ?? "out";
  const query = spec.query ?? [];
  const nodes: Workflow["nodes"] = [
    { id: "in", op: "boundary.http.request", config: { method: spec.method, path: spec.path } },
    { id: "call", op: spec.op },
    { id: "status", op: "boundary.http.status" },
    { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
  ];
  const edges: Workflow["edges"] = [];
  if (query.length) {
    nodes.push({ id: "ex_query", op: "core.object.extract", config: { keys: query } });
    edges.push({ from: { node: "in", port: "query" }, to: { node: "ex_query", port: "object" } });
    for (const k of query) edges.push({ from: { node: "ex_query", port: k }, to: { node: "call", port: k } });
  } else {
    edges.push({ from: { node: "in", port: "out" }, to: { node: "call", port: "in" } });
  }
  edges.push({ from: { node: "call", port: out }, to: { node: "status", port: "result" } });
  edges.push({ from: { node: "status", port: "status" }, to: { node: "out", port: "status" } });
  edges.push({ from: { node: "status", port: "body" }, to: { node: "out", port: "body" } });
  return { id: spec.id, name: `Identity · ${spec.method} ${spec.path}`, source: "code", nodes, edges };
}

/** The identity routes under `mount` (default /auth). */
export function endpointWorkflows(mount: string): Workflow[] {
  const specs: EndpointSpec[] = [
    { id: "identity.route.login", method: "GET", path: `${mount}/login`, op: "identity.login.page", shape: "http" },
    { id: "identity.route.token", method: "GET", path: `${mount}/token`, op: "identity.token.callback", shape: "http" },
    { id: "identity.route.logout", method: "POST", path: `${mount}/logout`, op: "identity.logout", shape: "http" },
    { id: "identity.route.whoami", method: "GET", path: `${mount}/whoami`, op: "identity.whoami", shape: "json", out: "whoami" },
    { id: "identity.route.welcome", method: "GET", path: `${mount}/welcome`, op: "identity.welcome.page", shape: "http" },
    { id: "identity.route.bootstrap", method: "GET", path: `${mount}/bootstrap`, op: "identity.bootstrap.page", shape: "http" },
    { id: "identity.route.bootstrap.submit", method: "POST", path: `${mount}/bootstrap`, op: "identity.bootstrap.submit", shape: "http" },
  ];
  return specs.map(endpoint);
}
