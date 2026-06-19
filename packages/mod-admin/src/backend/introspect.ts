/**
 * @pattern/mod-admin — engine introspection (admin internals §10, §13).
 *
 * Pure helpers that turn the live engine into the data the admin renders: the
 * op/node browser, the catalog (merging code + stored workflows), the mod view,
 * port-compatibility checks, and a deterministic "explain this workflow". Every
 * config surfaced here is run through the engine's redaction so secrets never
 * leak (P4).
 */

import {
  portCompatibility,
  portKindOf,
  redactConfig,
  resolveConfigInputs,
  resolveControlOuts,
  resolvePorts,
  z,
  type Engine,
  type OpDefinition,
  type PortSpec,
  type Workflow,
} from "@pattern/core";
import type { WorkflowMeta, WorkflowStore } from "./control-plane/types.js";
import { extractRoute } from "./control-plane/store.js";

export interface PortInfo {
  name: string;
  kind: PortSpec["kind"];
  required?: boolean;
  description?: string;
  schema?: unknown;
}

export interface OpInfo {
  type: string;
  title?: string;
  description?: string;
  category: string;
  boundary?: "trigger" | "outgate";
  /** Boundary ops: the op type of the canonical partner (trigger ↔ out-gate). */
  pair?: string;
  /** The mod that contributed this op (undefined = base catalog). */
  mod?: string;
  inputs: PortInfo[];
  outputs: PortInfo[];
  /** Registration-time config ports (boundary ops) — wired like value inputs. */
  configInputs: PortInfo[];
  controlOut: string[];
  configSchema?: unknown;
  /** How many registered workflows use this op. */
  usedBy: number;
  /** The ids of those workflows (clickable in the catalog). */
  usedByWorkflows: string[];
  /** Meant for general authoring/reuse (default true; false = de-emphasized). */
  reusable: boolean;
  /** Does meaningful synchronous compute — the editor nudges toward Offload. */
  cpuHeavy?: boolean;
}

export interface ModInfo {
  name: string;
  ops: string[];
  workflows: string[];
  frontend?: { menu: number; pages: number; commands: number; assets?: string };
}

/** Derive a display category from an op type id. */
function categoryOf(type: string): string {
  const parts = type.split(".");
  if (parts[0] === "core") return parts[1] ?? "core";
  if (parts[0] === "boundary") return "boundary";
  return parts[0] ?? "misc";
}

function jsonSchema(schema: z.ZodType | undefined): unknown {
  if (!schema) return undefined;
  try {
    return z.toJSONSchema(schema, { unrepresentable: "any" } as never);
  } catch {
    return undefined;
  }
}

function portInfos(def: OpDefinition["inputs"], config: unknown): PortInfo[] {
  return Object.entries(resolvePorts(def, config)).map(([name, spec]) => ({
    name,
    kind: spec.kind,
    required: spec.required,
    description: spec.description,
    schema: jsonSchema(spec.schema),
  }));
}

/** Registered workflows referencing an op type (ids, for clickable usage). */
function usedByWorkflows(engine: Engine, type: string): string[] {
  const ids: string[] = [];
  for (const wf of engine.workflows.list()) if (wf.nodes.some((node) => node.op === type)) ids.push(wf.id);
  return ids.sort();
}

/** The mod that contributed an op type, if any. */
function modOf(engine: Engine, type: string): string | undefined {
  for (const m of engine.installedMods()) if (m.opTypes.includes(type)) return m.name;
  return undefined;
}

export function opInfo(engine: Engine, op: OpDefinition): OpInfo {
  return {
    type: op.type,
    title: op.title,
    description: op.description,
    category: categoryOf(op.type),
    boundary: op.boundary,
    pair: op.pair,
    mod: modOf(engine, op.type),
    inputs: portInfos(op.inputs, {}),
    outputs: portInfos(op.outputs, {}),
    configInputs: op.configInputs ? portInfos(op.configInputs, {}) : [],
    controlOut: resolveControlOuts(op, {}),
    configSchema: jsonSchema(op.config),
    usedBy: usedByWorkflows(engine, op.type).length,
    usedByWorkflows: usedByWorkflows(engine, op.type),
    reusable: op.reusable !== false,
    ...(op.cpuHeavy ? { cpuHeavy: true } : {}),
  };
}

/**
 * Per-node ports for a DOC, resolved with each node's actual config — the
 * editor's answer for dynamic-port ops (`core.object.build` keys,
 * `boundary.manual` outputs, `core.flow.sequence` control-outs…). Port
 * resolvers live server-side as functions, so the client asks instead of
 * guessing; a node whose config breaks its resolver falls back to defaults.
 */
export function docPorts(
  engine: Engine,
  doc: { nodes: Array<{ id: string; op: string; config?: unknown }> },
): Record<string, { inputs: PortInfo[]; outputs: PortInfo[]; configInputs: PortInfo[]; controlOut: string[] }> {
  const out: Record<string, { inputs: PortInfo[]; outputs: PortInfo[]; configInputs: PortInfo[]; controlOut: string[] }> = {};
  for (const node of doc.nodes ?? []) {
    const op = engine.ops.get(node.op);
    if (!op) continue;
    const config = node.config ?? {};
    try {
      out[node.id] = {
        inputs: portInfos(op.inputs, config),
        outputs: portInfos(op.outputs, config),
        configInputs: op.configInputs ? portInfos(op.configInputs, config) : [],
        controlOut: resolveControlOuts(op, config),
      };
    } catch {
      out[node.id] = {
        inputs: portInfos(op.inputs, {}),
        outputs: portInfos(op.outputs, {}),
        configInputs: op.configInputs ? portInfos(op.configInputs, {}) : [],
        controlOut: resolveControlOuts(op, {}),
      };
    }
  }
  return out;
}

export function opList(engine: Engine): OpInfo[] {
  return engine.ops
    .list()
    .map((op) => opInfo(engine, op))
    .sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
}

export function opGet(engine: Engine, type: string): OpInfo | null {
  const op = engine.ops.get(type);
  return op ? opInfo(engine, op) : null;
}

export function modList(engine: Engine): ModInfo[] {
  return engine.installedMods().map((m) => ({
    name: m.name,
    ops: m.opTypes,
    workflows: m.workflowIds,
    frontend: m.frontend
      ? {
          menu: m.frontend.menu?.length ?? 0,
          pages: m.frontend.pages?.length ?? 0,
          commands: m.frontend.commands?.length ?? 0,
          assets: m.frontend.assets,
        }
      : undefined,
  }));
}

/**
 * The full workflow catalog: every stored (file/db) workflow plus every
 * engine-registered workflow not in the store, synthesized as `source: "code"`.
 * Code workflows are read-only/forkable; file workflows are authorable.
 */
export async function catalog(engine: Engine, store: WorkflowStore, parkedCode?: Map<string, Workflow>): Promise<WorkflowMeta[]> {
  const metas = await store.list();
  const known = new Set(metas.map((m) => m.slug));
  const codeMeta = (wf: Workflow, enabled: boolean): WorkflowMeta => ({
    slug: wf.id,
    name: wf.name ?? wf.id,
    description: wf.description,
    source: "code",
    enabled,
    live: enabled ? "code" : null,
    route: extractRoute(wf),
    tags: wf.tags,
    versions: [{ id: "code", hash: "code", createdAt: "" }],
    audit: [],
  });
  for (const wf of engine.workflows.list()) {
    if (known.has(wf.id)) continue;
    known.add(wf.id);
    metas.push(codeMeta(wf, true));
  }
  // Undeployed (parked) code workflows stay in the catalog, shown disabled.
  for (const wf of parkedCode?.values() ?? []) {
    if (known.has(wf.id)) continue;
    known.add(wf.id);
    metas.push(codeMeta(wf, false));
  }
  metas.sort((a, b) => a.slug.localeCompare(b.slug));
  return metas;
}

/** Resolve a port reference {op, port, dir} to its PortSpec for compat checks.
 *  Honors the implicit control ports (`in`/`out`), declared control-outs, and
 *  registration-time config inputs — anything the editor renders as a handle. */
function resolvePortRef(engine: Engine, ref: { op: string; port: string; dir: "in" | "out" }): PortSpec | undefined {
  const op = engine.ops.get(ref.op);
  if (!op) return undefined;
  const declared =
    resolvePorts(ref.dir === "in" ? op.inputs : op.outputs, {})[ref.port] ??
    (ref.dir === "in" ? resolveConfigInputs(op, {})[ref.port] : undefined);
  if (declared) return declared;
  return portKindOf(op, {}, ref.port, ref.dir) === "control" ? { kind: "control" } : undefined;
}

export interface PortRef {
  op: string;
  port: string;
  dir: "in" | "out";
}

/** Port-compatibility for the editor's connection assist (T2). */
export function portsCompatible(engine: Engine, from: PortRef, to: PortRef) {
  const fromSpec = resolvePortRef(engine, from);
  const toSpec = resolvePortRef(engine, to);
  if (!fromSpec) return { ok: false, reason: `unknown output port ${from.op}.${from.port}` };
  if (!toSpec) return { ok: false, reason: `unknown input port ${to.op}.${to.port}` };
  return portCompatibility(fromSpec, toSpec);
}

/**
 * A deterministic, offline structural summary of a workflow (§15.7). Walks
 * trigger → ops → out-gate using each node's title/op + branch structure. No AI.
 */
export function explain(engine: Engine, doc: Workflow): string {
  const byId = new Map(doc.nodes.map((n) => [n.id, n] as const));
  const lines: string[] = [];
  lines.push(`Workflow "${doc.name ?? doc.id}"${doc.description ? `: ${doc.description}` : ""}.`);

  const triggers = doc.nodes.filter((n) => engine.ops.get(n.op)?.boundary === "trigger");
  const outgates = doc.nodes.filter((n) => engine.ops.get(n.op)?.boundary === "outgate");
  const describe = (id: string): string => {
    const n = byId.get(id);
    if (!n) return id;
    const op = engine.ops.get(n.op);
    return n.title ?? op?.title ?? n.op;
  };

  for (const t of triggers) {
    const op = engine.ops.get(t.op);
    lines.push(`• Triggered by ${describe(t.id)} (${t.op})${t.comment ? ` — ${t.comment}` : ""}.`);
    // Walk forward in BFS order, naming each step once.
    const seen = new Set<string>([t.id]);
    const queue = doc.edges.filter((e) => e.from.node === t.id).map((e) => e.to.node);
    const steps: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (node && engine.ops.get(node.op)?.boundary !== "outgate") steps.push(describe(id));
      for (const e of doc.edges.filter((e) => e.from.node === id)) queue.push(e.to.node);
    }
    if (steps.length) lines.push(`  → ${steps.join(" → ")}`);
  }
  if (outgates.length) {
    lines.push(`• Result delivered by ${outgates.map((g) => `${describe(g.id)} (${g.op})`).join(", ")}.`);
  }
  return lines.join("\n");
}

export interface SystemMap {
  routes: Array<{ method: string; path: string; port?: number; workflow: string; conflict: boolean }>;
  apps: Array<{ mount: string; port?: number; workflow: string; filesystem: string }>;
  schedules: Array<{ workflow: string; node: string; cron?: string; intervalMs?: number }>;
  hooks: Array<{ hook: string; workflow: string; node: string; priority: number }>;
  events: Array<{ event: string; workflow: string; node: string }>;
  ws: Array<{ workflow: string; node: string; kind: string }>;
  ports: number[];
}

/** Build the System map from the engine's registered workflows (§13). */
export function systemMap(engine: Engine): SystemMap {
  const map: SystemMap = { routes: [], apps: [], schedules: [], hooks: [], events: [], ws: [], ports: [] };
  // Parse through the op's config schema when it has one, so defaults (e.g. an
  // app op's bundled filesystem) surface here without re-running the workflow.
  const cfgOf = (node: { op: string; config?: unknown }): Record<string, any> => {
    const schema = engine.ops.get(node.op)?.config;
    if (schema) {
      const parsed = schema.safeParse(node.config ?? {});
      if (parsed.success) return parsed.data as Record<string, any>;
    }
    return (node.config ?? {}) as Record<string, any>;
  };
  for (const wf of engine.workflows.list()) {
    for (const node of wf.nodes) {
      const c = cfgOf(node);
      switch (node.op) {
        case "boundary.http.request":
          if (c.path) map.routes.push({ method: String(c.method ?? "GET").toUpperCase(), path: c.path, port: c.port, workflow: wf.id, conflict: false });
          break;
        case "boundary.http.app": {
          // The app descriptor is produced by the app op downstream (e.g.
          // core.app.static / admin.app); statically, its parsed config carries
          // the filesystem. The host resolves the real thing by running once.
          const appNode = wf.nodes.find((n) => n !== node && typeof cfgOf(n).filesystem === "string");
          const fsImpl = appNode ? cfgOf(appNode).filesystem : "(run-resolved)";
          map.apps.push({ mount: c.mount ?? "/", port: c.port, workflow: wf.id, filesystem: fsImpl });
          break;
        }
        case "boundary.schedule":
          map.schedules.push({ workflow: wf.id, node: node.id, cron: c.cron, intervalMs: c.intervalMs });
          break;
        case "boundary.hook":
          if (c.hook) map.hooks.push({ hook: c.hook, workflow: wf.id, node: node.id, priority: c.priority ?? 100 });
          break;
        case "boundary.event":
          if (c.event) map.events.push({ event: c.event, workflow: wf.id, node: node.id });
          break;
        case "boundary.ws.message":
        case "boundary.ws.open":
        case "boundary.ws.close":
        case "boundary.ws.send":
          map.ws.push({ workflow: wf.id, node: node.id, kind: node.op.replace("boundary.ws.", "") });
          break;
      }
    }
  }
  // Flag route conflicts (same method+path+port).
  const seen = new Map<string, number>();
  for (const r of map.routes) {
    const k = `${r.method} ${r.path} ${r.port ?? ""}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const r of map.routes) if ((seen.get(`${r.method} ${r.path} ${r.port ?? ""}`) ?? 0) > 1) r.conflict = true;
  map.hooks.sort((a, b) => a.hook.localeCompare(b.hook) || a.priority - b.priority);
  map.ports = [...new Set([...map.routes.map((r) => r.port), ...map.apps.map((a) => a.port)].filter((p): p is number => typeof p === "number"))];
  return map;
}

/** Redacted node config (delegates to the engine; safe to surface). */
export function safeNodeConfigs(engine: Engine, workflowId: string): Record<string, unknown> {
  const wf = engine.workflows.get(workflowId);
  if (!wf) return {};
  const out: Record<string, unknown> = {};
  for (const node of wf.nodes) out[node.id] = engine.redactedConfig(workflowId, node.id);
  return out;
}
