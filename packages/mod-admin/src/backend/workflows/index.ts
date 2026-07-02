/**
 * @pattern-js/mod-admin — endpoint workflows (admin internals §11).
 *
 * The admin API *is* a set of Pattern workflows, and each one is a worked
 * example of the idiom: the op is a PURE domain function with discrete, named
 * ports; the WORKFLOW is the service. So a route is
 * `http.request → core.object.extract (decompose) → admin.<op> → http.response`.
 * The trigger declares the input schema (derived from the op's port schemas);
 * each request part (params/query/body) is decomposed into the op's input ports
 * with `core.object.extract`; the op's named output becomes the response body
 * (or an SSE stream for the live tail). The host derives its routes by scanning
 * these, so the admin's own backend stays visible + editable inside the admin.
 */

import { z, type Workflow } from "@pattern-js/core";
import { adminOpRoutes, type InSpec } from "../ops/index.js";

export interface EndpointSpec {
  id: string;
  method: string;
  path: string;
  op: string;
  mode?: "buffered" | "sse";
}

const API = "/admin/api";
const SRCS = ["params", "query", "body"] as const;

/** A permissive JSON-Schema type for one port (probe-based — no brittle introspection). */
function jsonType(s: z.ZodType): Record<string, unknown> {
  const ok = (v: unknown) => s.safeParse(v).success;
  if (ok("x") && !ok(1) && !ok(true)) return { type: "string" };
  if (ok(1) && !ok("x")) return { type: "number" };
  if (ok(true) && !ok("x") && !ok(1)) return { type: "boolean" };
  if (ok({}) && !ok("x") && !ok(1)) return { type: "object" };
  return {}; // unknown / union → any (still declared as a property)
}

/** A request part's JSON Schema, from the op's ports sourced there (no additionalProperties — the SPA may send extra). */
function schemaFor(ports: Array<[string, InSpec]>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, spec] of ports) {
    properties[name] = jsonType(spec.schema);
    if (!spec.schema.safeParse(undefined).success) required.push(name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

/**
 * Build one endpoint workflow: declare the schema, decompose the request into
 * the op's input ports, run the op, name the response.
 */
function endpoint(spec: EndpointSpec): Workflow {
  const io = adminOpRoutes[spec.op];
  if (!io) throw new Error(`admin endpoint "${spec.id}": no route I/O registered for op "${spec.op}"`);
  const sse = spec.mode === "sse";
  const entries = Object.entries(io.in);
  const bySrc = Object.fromEntries(SRCS.map((s) => [s, entries.filter(([, v]) => v.src === s)])) as Record<
    (typeof SRCS)[number],
    Array<[string, InSpec]>
  >;

  // Trigger config: route + a declared input schema for each non-empty part.
  const triggerConfig: Record<string, unknown> = { method: spec.method, path: spec.path };
  for (const src of SRCS) if (bySrc[src].length) triggerConfig[src] = schemaFor(bySrc[src]);

  const nodes: Workflow["nodes"] = [
    { id: "in", op: "boundary.http.request", config: triggerConfig },
    { id: "call", op: spec.op },
    { id: "out", op: "boundary.http.response", config: { mode: sse ? "sse" : "buffered" } },
  ];
  const edges: Workflow["edges"] = [];

  // Decompose: one core.object.extract per request part → the op's input ports.
  let anyInput = false;
  for (const src of SRCS) {
    const ports = bySrc[src];
    if (!ports.length) continue;
    anyInput = true;
    const ex = `ex_${src}`;
    nodes.push({ id: ex, op: "core.object.extract", config: { keys: ports.map(([n]) => n) } });
    edges.push({ from: { node: "in", port: src }, to: { node: ex, port: "object" } });
    for (const [name] of ports) edges.push({ from: { node: ex, port: name }, to: { node: "call", port: name } });
  }
  // No-input op: sequence it after the trigger with a control pulse.
  if (!anyInput) edges.push({ from: { node: "in", port: "out" }, to: { node: "call", port: "in" } });

  // Recompose:
  //  - SSE: the stream goes straight to the response (status defaults 200).
  //  - single output: through boundary.http.status, so a domain outcome
  //    (httpOutcome) becomes the right 4xx and data stays a 200.
  //  - multiple outputs: core.object.build (these ops have no domain-error case).
  if (sse) {
    edges.push({ from: { node: "call", port: io.out as string }, to: { node: "out", port: "stream" } });
  } else if (typeof io.out === "string") {
    nodes.push({ id: "status", op: "boundary.http.status" });
    edges.push({ from: { node: "call", port: io.out }, to: { node: "status", port: "result" } });
    edges.push({ from: { node: "status", port: "status" }, to: { node: "out", port: "status" } });
    edges.push({ from: { node: "status", port: "body" }, to: { node: "out", port: "body" } });
  } else {
    nodes.push({ id: "body", op: "core.object.build", config: { keys: io.out } });
    for (const k of io.out) edges.push({ from: { node: "call", port: k }, to: { node: "body", port: k } });
    edges.push({ from: { node: "body", port: "out" }, to: { node: "out", port: "body" } });
  }

  return { id: spec.id, name: `Admin · ${spec.method} ${spec.path}`, source: "code", nodes, edges };
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
  { id: "admin.api.settings.get", method: "GET", path: `${API}/settings`, op: "admin.settings.get" },
  { id: "admin.api.settings.set", method: "POST", path: `${API}/settings`, op: "admin.settings.set" },
  { id: "admin.api.ui.manifest", method: "GET", path: `${API}/ui/manifest`, op: "admin.ui.manifest" },
  { id: "admin.api.run", method: "POST", path: `${API}/run`, op: "admin.run" },
  { id: "admin.api.doc.ports", method: "POST", path: `${API}/doc/ports`, op: "admin.doc.ports" },
  { id: "admin.api.templates", method: "GET", path: `${API}/templates`, op: "admin.template.list" },
];

/** Stamp `requireAuth` onto a workflow's trigger nodes (admin-spec P6). An
 *  explicit `false` declares "acknowledged-public" (distinct from undefined). */
export function stampRequireAuth(wf: Workflow, requirement: boolean | { scopes: string[] }): Workflow {
  return {
    ...wf,
    nodes: wf.nodes.map((n) =>
      n.op.startsWith("boundary.http.")
        ? { ...n, config: { ...((n.config as object) ?? {}), requireAuth: requirement } }
        : n,
    ),
  };
}

/** Build all admin endpoint workflows, stamping the given `requireAuth` (P6).
 *  `false` is stamped explicitly (acknowledged-public); undefined leaves it off. */
export function endpointWorkflows(auth?: boolean | { scopes: string[] }): Workflow[] {
  const wfs = endpointSpecs.map(endpoint);
  return auth === undefined ? wfs : wfs.map((w) => stampRequireAuth(w, auth));
}

/**
 * Serve a mod's Tier-2 page source as text/javascript (the `admin.ui.page` op).
 * Hand-built (not via `endpoint()`) because it returns raw JS, not a JSON body —
 * the body/headers/status wire straight to the response, like the blob route.
 * **Public** (UI code, not sensitive; and so `import()` needs no credentials) and
 * **internal** (framework plumbing, hidden from the catalog). NOT auth-stamped.
 */
export function uiPageRoute(): Workflow {
  return {
    id: "admin.api.ui.page",
    name: `Admin · GET ${API}/ui/page/:slug`,
    source: "code",
    internal: true,
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "GET", path: `${API}/ui/page/:slug` } },
      { id: "pick", op: "core.object.get", config: { path: "slug" } },
      { id: "page", op: "admin.ui.page" },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
    ],
    edges: [
      { from: { node: "in", port: "params" }, to: { node: "pick", port: "object" } },
      { from: { node: "pick", port: "out" }, to: { node: "page", port: "slug" } },
      { from: { node: "page", port: "status" }, to: { node: "out", port: "status" } },
      { from: { node: "page", port: "headers" }, to: { node: "out", port: "headers" } },
      { from: { node: "page", port: "body" }, to: { node: "out", port: "body" } },
    ],
  };
}
