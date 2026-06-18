/**
 * Pattern — the HTTP route builder (the op is an op, the workflow is the service).
 *
 * Every first-party HTTP route follows one shape, and this builder emits exactly
 * it: the trigger declares its input schema; `core.object.extract` decomposes
 * each request part (`params`/`query`/`body`) onto the op's discrete, named input
 * ports; the op runs as a PURE domain function (it never sees HTTP); and the
 * response is recomposed —
 *
 *   - a single named output goes through `boundary.http.status`, so a domain
 *     outcome (`httpOutcome`) becomes the right 4xx while data stays a 200;
 *   - an SSE stream goes straight to `response.stream`;
 *   - several named outputs are reassembled with `core.object.build`.
 *
 * This is a *constructor*, not a runtime dispatcher: it produces one explicit,
 * named, listable, editable workflow per route. Naming the route is the point —
 * the exposed surface is the route table, never a generic "run any op" endpoint.
 * mod-admin and every first-party mod build their routes through here.
 */

import { z } from "zod";
import type { Workflow } from "./types.js";

/** Which part of the request an op input port is sourced from. */
export type HttpSrc = "params" | "query" | "body";

/** One op input port: the request part it reads, and its schema (for the trigger). */
export interface PortSource {
  src: HttpSrc;
  schema: z.ZodType;
}

/** How a route maps the request onto an op's ports and the op's output onto the response. */
export interface RouteIO {
  /** Each op input port ← which request part (with its schema). Omit for a no-input op. */
  in?: Record<string, PortSource>;
  /** The op's output: one named port (status-mapped body), or several (object.build). */
  out: string | string[];
  /** The single named output is an SSE stream (→ response.stream). */
  stream?: boolean;
}

/** Tag an op input port's schema with the request part it reads. Params/query
 *  arrive as strings; the body as an arbitrary value — hence the defaults. */
export const fromParams = (schema: z.ZodType = z.string()): PortSource => ({ src: "params", schema });
export const fromQuery = (schema: z.ZodType = z.string()): PortSource => ({ src: "query", schema });
export const fromBody = (schema: z.ZodType = z.unknown()): PortSource => ({ src: "body", schema });

export interface HttpRouteSpec {
  /** Workflow id (stable; the host derives the route from the trigger). */
  id: string;
  /** Display name; defaults to `${method} ${path}`. */
  name?: string;
  method: string;
  /** Full HTTP path, e.g. "/admin/api/store/collections/:collection/docs". */
  path: string;
  /** The pure op this route is a service for. */
  op: string;
  io: RouteIO;
  /** Stamp `requireAuth` onto the boundary nodes (e.g. `{ scopes: ["admin"] }`). */
  auth?: true | { scopes: string[] };
}

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

/** A request part's JSON Schema, from the op's ports sourced there (open — the client may send extra). */
function schemaFor(ports: Array<[string, PortSource]>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, spec] of ports) {
    properties[name] = jsonType(spec.schema);
    if (!spec.schema.safeParse(undefined).success) required.push(name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

/** Stamp `requireAuth` onto a workflow's HTTP boundary nodes. */
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

/**
 * Build one purposeful HTTP route workflow: declare the input schema, decompose
 * the request into the op's input ports, run the op, name the response.
 */
export function httpEndpoint(spec: HttpRouteSpec): Workflow {
  const io = spec.io;
  const sse = io.stream === true;
  const entries = Object.entries(io.in ?? {});
  const bySrc = Object.fromEntries(SRCS.map((s) => [s, entries.filter(([, v]) => v.src === s)])) as Record<
    (typeof SRCS)[number],
    Array<[string, PortSource]>
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
  //  - multiple outputs: core.object.build (no single domain-error case).
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

  const wf: Workflow = {
    id: spec.id,
    name: spec.name ?? `${spec.method} ${spec.path}`,
    source: "code",
    nodes,
    edges,
  };
  return spec.auth ? stampRequireAuth(wf, spec.auth) : wf;
}
