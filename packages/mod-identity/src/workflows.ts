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

interface EndpointSpec {
  id: string;
  method: string;
  path: string;
  op: string;
  /** "http" wires headers in and status/headers/body out; "json" wires body only. */
  shape: "http" | "json";
}

function endpoint(spec: EndpointSpec): Workflow {
  const httpShape = spec.shape === "http";
  return {
    id: spec.id,
    name: `Identity · ${spec.method} ${spec.path}`,
    source: "code",
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: spec.method, path: spec.path } },
      { id: "call", op: spec.op },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
    ],
    edges: [
      { from: { node: "in", port: "params" }, to: { node: "call", port: "params" } },
      { from: { node: "in", port: "query" }, to: { node: "call", port: "query" } },
      { from: { node: "in", port: "body" }, to: { node: "call", port: "body" } },
      ...(httpShape
        ? [
            { from: { node: "in", port: "headers" }, to: { node: "call", port: "headers" } },
            { from: { node: "call", port: "status" }, to: { node: "out", port: "status" } },
            { from: { node: "call", port: "headers" }, to: { node: "out", port: "headers" } },
            { from: { node: "call", port: "body" }, to: { node: "out", port: "body" } },
          ]
        : [{ from: { node: "call", port: "out" }, to: { node: "out", port: "body" } }]),
    ],
  };
}

/** The identity routes under `mount` (default /auth). */
export function endpointWorkflows(mount: string): Workflow[] {
  const specs: EndpointSpec[] = [
    { id: "identity.route.login", method: "GET", path: `${mount}/login`, op: "identity.login.page", shape: "http" },
    { id: "identity.route.token", method: "GET", path: `${mount}/token`, op: "identity.token.callback", shape: "http" },
    { id: "identity.route.logout", method: "POST", path: `${mount}/logout`, op: "identity.logout", shape: "http" },
    { id: "identity.route.whoami", method: "GET", path: `${mount}/whoami`, op: "identity.whoami", shape: "json" },
    { id: "identity.route.welcome", method: "GET", path: `${mount}/welcome`, op: "identity.welcome.page", shape: "http" },
    { id: "identity.route.bootstrap", method: "GET", path: `${mount}/bootstrap`, op: "identity.bootstrap.page", shape: "http" },
    { id: "identity.route.bootstrap.submit", method: "POST", path: `${mount}/bootstrap`, op: "identity.bootstrap.submit", shape: "http" },
  ];
  return specs.map(endpoint);
}
