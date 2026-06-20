/**
 * @pattern-js/mod-admin — versioning helpers (admin internals §5).
 *
 * Content-addressed snapshots (a stable hash over the doc, ignoring data-only
 * `ui`) and a structural JSON diff between any two versions: nodes/edges/config
 * added/removed/changed, with an optional toggle to ignore data-only
 * `ui`/`title`/`comment`.
 */

import { createHash } from "node:crypto";
import type { Edge, Workflow, WorkflowNode } from "@pattern-js/core";

/** Deterministic JSON with sorted object keys (so hashes/diffs are stable). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Strip data-only canvas/label fields so the hash reflects behavior, not layout. */
function structural(doc: Workflow): unknown {
  return {
    nodes: doc.nodes.map((n) => ({ id: n.id, op: n.op, config: n.config ?? {} })),
    // Edge `ui` (portals) is annotation — behavior is from/to only.
    edges: doc.edges.map((e) => ({ from: e.from, to: e.to })),
  };
}

/** Content hash of a workflow's *behavior* (ignores `ui`/`title`/`comment`). */
export function contentHash(doc: Workflow): string {
  return createHash("sha256").update(stableStringify(structural(doc))).digest("hex").slice(0, 16);
}

// ── Structural diff ──

export interface NodeChange {
  id: string;
  before: Pick<WorkflowNode, "op" | "config" | "title" | "comment">;
  after: Pick<WorkflowNode, "op" | "config" | "title" | "comment">;
}

export interface JsonDiff {
  /** True when the two versions are structurally identical (per `ignoreUi`). */
  equal: boolean;
  nodes: { added: WorkflowNode[]; removed: WorkflowNode[]; changed: NodeChange[] };
  edges: { added: Edge[]; removed: Edge[] };
  meta: { field: string; before: unknown; after: unknown }[];
}

const edgeKey = (e: Edge): string => `${e.from.node}.${e.from.port}->${e.to.node}.${e.to.port}`;

function nodeFields(n: WorkflowNode, ignoreUi: boolean) {
  return ignoreUi
    ? { op: n.op, config: n.config ?? {} }
    : { op: n.op, config: n.config ?? {}, title: n.title, comment: n.comment };
}

/** Structural diff `a → b`. With `ignoreUi`, data-only fields don't count. */
export function diffWorkflows(a: Workflow, b: Workflow, ignoreUi = false): JsonDiff {
  const aNodes = new Map(a.nodes.map((n) => [n.id, n] as const));
  const bNodes = new Map(b.nodes.map((n) => [n.id, n] as const));

  const added: WorkflowNode[] = [];
  const removed: WorkflowNode[] = [];
  const changed: NodeChange[] = [];

  for (const [id, bn] of bNodes) {
    const an = aNodes.get(id);
    if (!an) {
      added.push(bn);
    } else if (stableStringify(nodeFields(an, ignoreUi)) !== stableStringify(nodeFields(bn, ignoreUi))) {
      changed.push({
        id,
        before: { op: an.op, config: an.config, title: an.title, comment: an.comment },
        after: { op: bn.op, config: bn.config, title: bn.title, comment: bn.comment },
      });
    }
  }
  for (const [id, an] of aNodes) if (!bNodes.has(id)) removed.push(an);

  const aEdges = new Map(a.edges.map((e) => [edgeKey(e), e] as const));
  const bEdges = new Map(b.edges.map((e) => [edgeKey(e), e] as const));
  const edgesAdded = [...bEdges].filter(([k]) => !aEdges.has(k)).map(([, e]) => e);
  const edgesRemoved = [...aEdges].filter(([k]) => !bEdges.has(k)).map(([, e]) => e);

  const meta: JsonDiff["meta"] = [];
  for (const field of ["name", "description", "tags", "offload"] as const) {
    const av = (a as Record<string, unknown>)[field];
    const bv = (b as Record<string, unknown>)[field];
    if (stableStringify(av) !== stableStringify(bv)) meta.push({ field, before: av, after: bv });
  }

  const equal =
    added.length === 0 &&
    removed.length === 0 &&
    changed.length === 0 &&
    edgesAdded.length === 0 &&
    edgesRemoved.length === 0 &&
    meta.length === 0;

  return { equal, nodes: { added, removed, changed }, edges: { added: edgesAdded, removed: edgesRemoved }, meta };
}
