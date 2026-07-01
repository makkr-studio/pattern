/**
 * @pattern-js/mod-auth-oidc — the per-provider route workflows.
 *
 * mod-identity's endpoint style: each route is `http.request → auth.oidc.* →
 * http.response`, with the request decomposed into the op's discrete ports
 * (query fields, cookies, url, user-agent) so the op never sees HTTP — the
 * quartet { body, redirect, cookies, status } becomes Location/Set-Cookie on
 * the out-gate.
 */

import type { Workflow } from "@pattern-js/core";

const CT = { "content-type": "text/html; charset=utf-8" };

function quartet(edges: Workflow["edges"]): void {
  for (const port of ["body", "redirect", "cookies", "status"]) {
    edges.push({ from: { node: "call", port }, to: { node: "out", port } });
  }
  edges.push({ from: { node: "ct", port: "out" }, to: { node: "out", port: "headers" } });
}

function startRoute(mount: string, providerId: string): Workflow {
  const path = `${mount}/oidc/${providerId}/start`;
  const edges: Workflow["edges"] = [
    { from: { node: "in", port: "query" }, to: { node: "ex", port: "object" } },
    { from: { node: "ex", port: "next" }, to: { node: "call", port: "next" } },
    { from: { node: "in", port: "url" }, to: { node: "call", port: "url" } },
  ];
  quartet(edges);
  return {
    id: `oidc.route.${providerId}.start`,
    name: `OIDC · GET ${path}`,
    source: "code",
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "GET", path } },
      { id: "ex", op: "core.object.extract", config: { keys: ["next"] } },
      { id: "call", op: "auth.oidc.start", config: { provider: providerId } },
      { id: "ct", op: "core.const.object", config: { value: CT } },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
    ],
    edges,
  };
}

function callbackRoute(mount: string, providerId: string): Workflow {
  const path = `${mount}/oidc/${providerId}/callback`;
  const query = ["code", "state", "error", "error_description"];
  const edges: Workflow["edges"] = [
    { from: { node: "in", port: "query" }, to: { node: "ex", port: "object" } },
    ...query.map((k) => ({ from: { node: "ex", port: k }, to: { node: "call", port: k } })),
    { from: { node: "in", port: "cookies" }, to: { node: "call", port: "cookies" } },
    { from: { node: "in", port: "url" }, to: { node: "call", port: "url" } },
    { from: { node: "in", port: "headers" }, to: { node: "ua", port: "object" } },
    { from: { node: "ua", port: "out" }, to: { node: "call", port: "userAgent" } },
  ];
  quartet(edges);
  return {
    id: `oidc.route.${providerId}.callback`,
    name: `OIDC · GET ${path}`,
    source: "code",
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "GET", path } },
      { id: "ex", op: "core.object.extract", config: { keys: query } },
      { id: "ua", op: "core.object.get", config: { path: "user-agent" } },
      { id: "call", op: "auth.oidc.callback", config: { provider: providerId } },
      { id: "ct", op: "core.const.object", config: { value: CT } },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
    ],
    edges,
  };
}

export function oidcRoutes(mount: string, providerIds: string[]): Workflow[] {
  return providerIds.flatMap((id) => [startRoute(mount, id), callbackRoute(mount, id)]);
}
