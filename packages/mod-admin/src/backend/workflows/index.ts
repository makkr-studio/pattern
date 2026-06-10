/**
 * @pattern/mod-admin — endpoint workflows (mod-admin-spec §11).
 *
 * The admin API *is* a set of Pattern workflows: each route is
 * `http.request → admin.<op> → http.response`. The HTTP host derives its routes
 * by scanning these, so the admin's own backend is visible and editable inside
 * the admin (total self-reflection). The request's params/query/body are wired
 * uniformly into the op; the op's result becomes the response body (or an SSE
 * stream for the live tail).
 */

import type { Workflow } from "@pattern/core";

export interface EndpointSpec {
  id: string;
  method: string;
  path: string;
  op: string;
  mode?: "buffered" | "sse";
}

const API = "/admin/api";

/** Build one `http.request → op → http.response` endpoint workflow. */
function endpoint(spec: EndpointSpec): Workflow {
  const sse = spec.mode === "sse";
  return {
    id: spec.id,
    name: `Admin · ${spec.method} ${spec.path}`,
    source: "code",
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: spec.method, path: spec.path } },
      { id: "call", op: spec.op },
      { id: "out", op: "boundary.http.response", config: { mode: sse ? "sse" : "buffered" } },
    ],
    edges: [
      { from: { node: "in", port: "params" }, to: { node: "call", port: "params" } },
      { from: { node: "in", port: "query" }, to: { node: "call", port: "query" } },
      { from: { node: "in", port: "body" }, to: { node: "call", port: "body" } },
      sse
        ? { from: { node: "call", port: "out" }, to: { node: "out", port: "stream" } }
        : { from: { node: "call", port: "out" }, to: { node: "out", port: "body" } },
    ],
  };
}

/**
 * The admin API surface. `run.tail` is listed before `runs/:runId` so the host
 * matches the literal `/runs/tail` route first (run ids are UUIDs, never "tail").
 */
export const endpointSpecs: EndpointSpec[] = [
  { id: "admin.api.workflows.list", method: "GET", path: `${API}/workflows`, op: "admin.workflow.list" },
  { id: "admin.api.workflow.get", method: "GET", path: `${API}/workflows/:slug`, op: "admin.workflow.get" },
  { id: "admin.api.workflow.save", method: "POST", path: `${API}/workflows/:slug`, op: "admin.workflow.save" },
  { id: "admin.api.workflow.delete", method: "DELETE", path: `${API}/workflows/:slug`, op: "admin.workflow.delete" },
  { id: "admin.api.workflow.setEnabled", method: "POST", path: `${API}/workflows/:slug/enabled`, op: "admin.workflow.setEnabled" },
  { id: "admin.api.workflow.explain", method: "GET", path: `${API}/workflows/:slug/explain`, op: "admin.workflow.explain" },
  { id: "admin.api.workflow.import", method: "POST", path: `${API}/import`, op: "admin.workflow.import" },
  { id: "admin.api.deploy", method: "POST", path: `${API}/deploy/:slug`, op: "admin.workflow.deploy" },
  { id: "admin.api.versions.list", method: "GET", path: `${API}/workflows/:slug/versions`, op: "admin.version.list" },
  { id: "admin.api.versions.get", method: "GET", path: `${API}/workflows/:slug/versions/:v`, op: "admin.version.get" },
  { id: "admin.api.versions.diff", method: "GET", path: `${API}/workflows/:slug/diff`, op: "admin.version.diff" },
  { id: "admin.api.fixtures.list", method: "GET", path: `${API}/workflows/:slug/fixtures`, op: "admin.fixture.list" },
  { id: "admin.api.fixtures.get", method: "GET", path: `${API}/workflows/:slug/fixtures/:name`, op: "admin.fixture.get" },
  { id: "admin.api.fixtures.save", method: "POST", path: `${API}/workflows/:slug/fixtures/:name`, op: "admin.fixture.save" },
  { id: "admin.api.fixtures.delete", method: "DELETE", path: `${API}/workflows/:slug/fixtures/:name`, op: "admin.fixture.delete" },
  { id: "admin.api.ops.list", method: "GET", path: `${API}/ops`, op: "admin.op.list" },
  { id: "admin.api.ops.get", method: "GET", path: `${API}/ops/:type`, op: "admin.op.get" },
  { id: "admin.api.ports.compatible", method: "POST", path: `${API}/ports/compatible`, op: "admin.ports.compatible" },
  { id: "admin.api.runs.tail", method: "GET", path: `${API}/runs/tail`, op: "admin.run.tail", mode: "sse" },
  { id: "admin.api.runs.list", method: "GET", path: `${API}/runs`, op: "admin.run.list" },
  { id: "admin.api.runs.get", method: "GET", path: `${API}/runs/:runId`, op: "admin.run.get" },
  { id: "admin.api.runs.cancel", method: "POST", path: `${API}/runs/:runId/cancel`, op: "admin.run.cancel" },
  { id: "admin.api.runs.pause", method: "POST", path: `${API}/runs/:runId/pause`, op: "admin.run.pause" },
  { id: "admin.api.runs.resume", method: "POST", path: `${API}/runs/:runId/resume`, op: "admin.run.resume" },
  { id: "admin.api.metrics", method: "GET", path: `${API}/metrics`, op: "admin.metrics.summary" },
  { id: "admin.api.mods", method: "GET", path: `${API}/mods`, op: "admin.mod.list" },
  { id: "admin.api.system", method: "GET", path: `${API}/system`, op: "admin.system.map" },
  { id: "admin.api.system.stats", method: "GET", path: `${API}/system/stats`, op: "admin.system.stats" },
  { id: "admin.api.system.bench", method: "POST", path: `${API}/system/bench`, op: "admin.system.bench" },
  { id: "admin.api.ui.manifest", method: "GET", path: `${API}/ui/manifest`, op: "admin.ui.manifest" },
  { id: "admin.api.invoke", method: "POST", path: `${API}/invoke`, op: "admin.invoke" },
  { id: "admin.api.run", method: "POST", path: `${API}/run`, op: "admin.run" },
  { id: "admin.api.templates", method: "GET", path: `${API}/templates`, op: "admin.template.list" },
];

/** Stamp `requireAuth` onto a workflow's trigger nodes (admin-spec P6). */
export function stampRequireAuth(wf: Workflow, requirement: true | { scopes: string[] }): Workflow {
  return {
    ...wf,
    nodes: wf.nodes.map((n) =>
      n.op.startsWith("boundary.http.")
        ? { ...n, config: { ...((n.config as object) ?? {}), requireAuth: requirement } }
        : n,
    ),
  };
}

/** Build all admin endpoint workflows, optionally stamping `requireAuth` (P6). */
export function endpointWorkflows(auth?: true | { scopes: string[] }): Workflow[] {
  const wfs = endpointSpecs.map(endpoint);
  return auth ? wfs.map((w) => stampRequireAuth(w, auth)) : wfs;
}
