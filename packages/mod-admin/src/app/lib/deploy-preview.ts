/**
 * What a deploy changes — computed client-side from two documents (the live
 * one and the one about to go live), so the preview works for a saved version
 * AND for an unsaved canvas. It answers the operator's questions, not the
 * diff's: which routes appear or disappear, whose auth gate changed, which
 * nodes will send or charge, and whether the execution model flipped.
 */

import type { OpInfo, WorkflowDoc } from "@pattern-js/admin-sdk";

type Node = WorkflowDoc["nodes"][number];

export interface DeployPreview {
  /** No live version yet — this deploy registers the workflow for the first time. */
  first: boolean;
  /** HTTP routes, as "GET /path". */
  routes: { added: string[]; removed: string[] };
  /** Trigger nodes whose `requireAuth` changed (before/after as short text). */
  auth: Array<{ node: string; before: string; after: string }>;
  /** External-effect nodes (send / charge / write) entering or leaving the graph. */
  external: { added: Array<{ node: string; op: string }>; removed: Array<{ node: string; op: string }> };
  /** Schedules, as "cron 0 * * * *" / "every 5000ms". */
  schedules: { added: string[]; removed: string[] };
  /** Workflow-level execution flags that flip. */
  flags: Array<{ flag: "durable" | "offload"; before: boolean; after: boolean }>;
  nodes: { added: number; removed: number; changed: number };
  edges: { added: number; removed: number };
  /** Nothing the engine cares about changes (ui-only edits still count as equal). */
  equal: boolean;
}

const cfg = (n: Node): Record<string, unknown> => (n.config && typeof n.config === "object" ? (n.config as Record<string, unknown>) : {});

function routeOf(n: Node): string | null {
  if (n.op !== "boundary.http.request") return null;
  const c = cfg(n);
  if (typeof c.path !== "string" || !c.path) return null;
  return `${String(c.method ?? "GET").toUpperCase()} ${c.path}${c.port ? ` :${String(c.port)}` : ""}`;
}

function scheduleOf(n: Node): string | null {
  if (n.op !== "boundary.schedule") return null;
  const c = cfg(n);
  if (typeof c.cron === "string" && c.cron) return `cron ${c.cron}`;
  if (typeof c.intervalMs === "number") return `every ${c.intervalMs}ms`;
  return null;
}

/** `requireAuth` as a short label: "none" / "any signed-in user" / "scopes: a, b". */
export function authLabel(v: unknown): string {
  if (v === undefined || v === null || v === false) return "none";
  if (v === true) return "any signed-in user";
  if (typeof v === "object") {
    const o = v as { scopes?: unknown; roles?: unknown };
    const parts: string[] = [];
    if (Array.isArray(o.scopes) && o.scopes.length) parts.push(`scopes: ${o.scopes.join(", ")}`);
    if (Array.isArray(o.roles) && o.roles.length) parts.push(`roles: ${o.roles.join(", ")}`);
    return parts.length ? parts.join(" · ") : "any signed-in user";
  }
  return JSON.stringify(v);
}

/**
 * Does this node reach outside the process? The engine's rule: an op that
 * declares nothing is external; boundary ops (triggers, out-gates) are the
 * graph's edges to the world, not senders, so they don't count here.
 */
export function isExternalNode(n: Node, ops: Map<string, OpInfo>): boolean {
  if (n.op.startsWith("boundary.")) return false;
  const op = ops.get(n.op);
  if (!op) return false; // unknown op — the save will refuse it anyway
  return op.effects === undefined || op.effects === "external" || op.effects === "dynamic";
}

/** The part of a node the engine reads (position/title/comment don't deploy). */
const behavior = (n: Node): string => JSON.stringify({ op: n.op, config: n.config ?? null, retry: n.retry ?? null });
const edgeKey = (e: WorkflowDoc["edges"][number]): string => `${e.from.node}.${e.from.port}→${e.to.node}.${e.to.port}`;

function diffSets(a: Iterable<string>, b: Iterable<string>): { added: string[]; removed: string[] } {
  const A = new Set(a);
  const B = new Set(b);
  return { added: [...B].filter((x) => !A.has(x)).sort(), removed: [...A].filter((x) => !B.has(x)).sort() };
}

export function deployPreview(live: WorkflowDoc | null, next: WorkflowDoc, ops: Map<string, OpInfo>): DeployPreview {
  const before = live ?? { id: next.id, nodes: [], edges: [] };
  const bn = new Map(before.nodes.map((n) => [n.id, n]));
  const an = new Map(next.nodes.map((n) => [n.id, n]));

  const routes = diffSets(before.nodes.map(routeOf).filter((r): r is string => r !== null), next.nodes.map(routeOf).filter((r): r is string => r !== null));
  const schedules = diffSets(
    before.nodes.map(scheduleOf).filter((r): r is string => r !== null),
    next.nodes.map(scheduleOf).filter((r): r is string => r !== null),
  );

  const auth: DeployPreview["auth"] = [];
  for (const n of next.nodes) {
    if (!n.op.startsWith("boundary.")) continue;
    const prev = bn.get(n.id);
    const b = authLabel(prev ? cfg(prev).requireAuth : undefined);
    const a = authLabel(cfg(n).requireAuth);
    if (a !== b && !(prev === undefined && a === "none")) auth.push({ node: n.id, before: prev ? b : "—", after: a });
  }
  for (const n of before.nodes) {
    if (!n.op.startsWith("boundary.") || an.has(n.id)) continue;
    const b = authLabel(cfg(n).requireAuth);
    if (b !== "none") auth.push({ node: n.id, before: b, after: "— (node removed)" });
  }

  const ext = (n: Node) => ({ node: n.id, op: n.op });
  const external = {
    added: next.nodes.filter((n) => isExternalNode(n, ops) && !bn.has(n.id)).map(ext),
    removed: before.nodes.filter((n) => isExternalNode(n, ops) && !an.has(n.id)).map(ext),
  };

  const flags: DeployPreview["flags"] = [];
  for (const flag of ["durable", "offload"] as const) {
    const b = before[flag] === true;
    const a = next[flag] === true;
    if (a !== b) flags.push({ flag, before: b, after: a });
  }

  let changed = 0;
  for (const n of next.nodes) {
    const prev = bn.get(n.id);
    if (prev && behavior(prev) !== behavior(n)) changed++;
  }
  const nodes = { added: next.nodes.filter((n) => !bn.has(n.id)).length, removed: before.nodes.filter((n) => !an.has(n.id)).length, changed };
  const e = diffSets(before.edges.map(edgeKey), next.edges.map(edgeKey));
  const edges = { added: e.added.length, removed: e.removed.length };

  const equal =
    live !== null &&
    nodes.added === 0 &&
    nodes.removed === 0 &&
    nodes.changed === 0 &&
    edges.added === 0 &&
    edges.removed === 0 &&
    flags.length === 0;

  return { first: live === null, routes, auth, external, schedules, flags, nodes, edges, equal };
}
