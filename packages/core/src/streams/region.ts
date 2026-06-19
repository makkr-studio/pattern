/**
 * §12 — Per-chunk stream regions.
 *
 * `core.stream.each` and `core.stream.collect` bracket a region of value ops on
 * the canvas. The scheduler runs that region **once per chunk, inline, in the
 * same run** (no sub-run, no new Runs entry). This module is the pure analysis
 * both validation and the scheduler share: it pairs each↔collect, finds the
 * interior **members** (the nodes strictly between them), the **captures**
 * (values pulled in from outside, computed once and threaded into every
 * iteration), and lowers the region to an inline **body** sub-workflow.
 *
 * Constraints (validated): members are plain value ops (no boundary, no stream
 * ports, no control-outs, no sub-run/branching ops — those would either re-enter
 * the stream world or spawn the sub-runs the whole feature exists to avoid); the
 * region is single-stream-in (each) / single-stream-out (collect); no value
 * escapes mid-region; regions don't nest (v1).
 */

import { outgoingEdges, incomingEdges, edgeInto, portKindOf, resolveControlOuts } from "../graph.js";
import type { OpRegistry } from "../registry.js";
import type { Edge, OpDefinition, Workflow, WorkflowNode } from "../types.js";

export const EACH_OP = "core.stream.each";
export const COLLECT_OP = "core.stream.collect";

const BODY_TRIGGER = "__region_in";
const BODY_RETURN = "__region_out";

/** A value pulled in from outside the region, computed once per run and passed
 *  into every iteration (closure capture). */
export interface RegionCapture {
  fromNode: string;
  fromPort: string;
  /** Synthetic body-trigger output name carrying it into each iteration. */
  name: string;
}

export interface StreamRegion {
  eachId: string;
  collectId: string;
  /** Interior node ids — run once per chunk. */
  members: string[];
  captures: RegionCapture[];
  /** Source of `collect.value` — the per-chunk result (a member, or the each). */
  valueFrom: { node: string; port: string };
}

export interface RegionIssue {
  nodeId: string;
  message: string;
}

export interface RegionAnalysis {
  regions: StreamRegion[];
  issues: RegionIssue[];
}

/** Ops that spawn sub-runs (`ctx.invoke`) — forbidden in a region: they'd create
 *  the very Runs entries the region exists to avoid. (Stream/boundary/control ops
 *  are caught structurally below.) */
const SUBRUN_OPS = new Set([
  "core.array.map",
  "core.array.filter",
  "core.array.reduce",
  "core.array.flatMap",
  "core.object.mapValues",
]);

function forwardReach(wf: Workflow, startId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of outgoingEdges(wf, id)) if (!seen.has(e.to.node)) (seen.add(e.to.node), stack.push(e.to.node));
  }
  return seen;
}

function backwardReach(wf: Workflow, endId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [endId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of incomingEdges(wf, id)) if (!seen.has(e.from.node)) (seen.add(e.from.node), stack.push(e.from.node));
  }
  return seen;
}

/** Why an op can't be a region member (or null if it's fine). */
function memberProblem(op: OpDefinition | undefined, node: WorkflowNode): string | null {
  if (!op) return `unknown op "${node.op}"`;
  if (op.boundary) return `boundary op "${op.type}" can't run per-chunk inside a region`;
  if (op.type === EACH_OP || op.type === COLLECT_OP) return `stream regions can't nest (found "${op.type}" inside a region)`;
  if (SUBRUN_OPS.has(op.type)) return `"${op.type}" spawns a sub-run — not allowed in a region (use plain value ops; that's the no-sub-run boundary)`;
  const cfg = node.config ?? {};
  for (const [port] of Object.entries(op.inputs ?? {})) {
    if (portKindOf(op, cfg, port, "in") === "stream") return `"${op.type}" takes a stream — regions process one chunk (a value) at a time`;
  }
  for (const [port] of Object.entries(op.outputs ?? {})) {
    if (portKindOf(op, cfg, port, "out") === "stream") return `"${op.type}" produces a stream — a region member must output a value`;
  }
  if (resolveControlOuts(op, cfg).length) return `"${op.type}" branches (control-outs) — not allowed in a region (v1)`;
  return null;
}

/**
 * Find every `each`↔`collect` region and validate it. Returns the well-formed
 * regions (for the scheduler) plus issues (for `collectIssues`). A region with
 * issues is omitted from `regions` so the scheduler never runs a malformed one.
 */
export function analyzeStreamRegions(workflow: Workflow, ops: OpRegistry): RegionAnalysis {
  const nodeById = new Map(workflow.nodes.map((n) => [n.id, n] as const));
  const eachIds = workflow.nodes.filter((n) => n.op === EACH_OP).map((n) => n.id);
  const collectIds = new Set(workflow.nodes.filter((n) => n.op === COLLECT_OP).map((n) => n.id));
  const regions: StreamRegion[] = [];
  const issues: RegionIssue[] = [];
  const pairedCollects = new Set<string>();

  for (const eachId of eachIds) {
    const fwd = forwardReach(workflow, eachId);
    const downstreamCollects = [...collectIds].filter((c) => fwd.has(c));
    if (downstreamCollects.length === 0) {
      issues.push({ nodeId: eachId, message: "core.stream.each has no matching core.stream.collect downstream" });
      continue;
    }
    if (downstreamCollects.length > 1) {
      issues.push({ nodeId: eachId, message: "core.stream.each reaches multiple core.stream.collect nodes — a region must have exactly one (v1: no nesting)" });
      continue;
    }
    const collectId = downstreamCollects[0]!;
    pairedCollects.add(collectId);
    const back = backwardReach(workflow, collectId);
    const members = [...fwd].filter((id) => back.has(id) && id !== collectId && id !== eachId);
    const memberSet = new Set(members);

    // Members must be plain value ops.
    let bad = false;
    for (const id of members) {
      const problem = memberProblem(ops.get(nodeById.get(id)!.op), nodeById.get(id)!);
      if (problem) {
        issues.push({ nodeId: id, message: problem });
        bad = true;
      }
    }

    // No value may escape the region (a member output going anywhere but another
    // member or collect): its value is per-chunk and can't feed a once-run node.
    for (const id of members) {
      for (const e of outgoingEdges(workflow, id)) {
        if (e.to.node === collectId || memberSet.has(e.to.node)) continue;
        issues.push({ nodeId: id, message: `value escapes the region (edge to "${e.to.node}") — a per-chunk value can't feed a node outside the region` });
        bad = true;
      }
    }

    // collect.value must be fed by a member (or directly by each — a passthrough).
    const valueEdge = edgeInto(workflow, collectId, "value");
    if (!valueEdge) {
      issues.push({ nodeId: collectId, message: "core.stream.collect.value is not wired — nothing to collect" });
      bad = true;
    } else if (valueEdge.from.node !== eachId && !memberSet.has(valueEdge.from.node)) {
      issues.push({ nodeId: collectId, message: "core.stream.collect.value must come from inside the region (a region op or the each's item)" });
      bad = true;
    }

    if (bad) continue;

    // Captures: value edges into a member from outside (each excluded → that's item/index).
    const captures: RegionCapture[] = [];
    const capByKey = new Map<string, string>();
    for (const id of members) {
      for (const e of incomingEdges(workflow, id)) {
        if (e.from.node === eachId || memberSet.has(e.from.node)) continue;
        const key = `${e.from.node} ${e.from.port}`;
        if (!capByKey.has(key)) {
          const name = `cap${captures.length}`;
          capByKey.set(key, name);
          captures.push({ fromNode: e.from.node, fromPort: e.from.port, name });
        }
      }
    }

    regions.push({ eachId, collectId, members, captures, valueFrom: valueEdge!.from });
  }

  for (const c of collectIds) {
    if (!pairedCollects.has(c)) issues.push({ nodeId: c, message: "core.stream.collect has no matching core.stream.each upstream" });
  }

  return { regions, issues };
}

/**
 * Lower a region to its inline **body** sub-workflow: a manual trigger emitting
 * `item` / `index` / each capture, the member nodes (original ids preserved so
 * replay maps spans back), and a return carrying the per-chunk `value`. Run once
 * per chunk by the scheduler via `runWorkflow({ inline: true })`.
 */
export function buildRegionBody(workflow: Workflow, region: StreamRegion): Workflow {
  const memberSet = new Set(region.members);
  const capName = new Map(region.captures.map((c) => [`${c.fromNode} ${c.fromPort}`, c.name]));
  const triggerOutputs = ["item", "index", ...region.captures.map((c) => c.name)];

  const nodes: WorkflowNode[] = [
    { id: BODY_TRIGGER, op: "boundary.manual", config: { outputs: triggerOutputs } },
    ...region.members.map((id) => {
      const n = workflow.nodes.find((m) => m.id === id)!;
      return { id: n.id, op: n.op, ...(n.config !== undefined ? { config: n.config } : {}) } as WorkflowNode;
    }),
    { id: BODY_RETURN, op: "boundary.return.named", config: { inputs: ["value"] } },
  ];

  const fromInBody = (e: Edge["from"]): Edge["from"] => {
    if (e.node === region.eachId) return { node: BODY_TRIGGER, port: e.port }; // item / index
    if (memberSet.has(e.node)) return e; // internal
    return { node: BODY_TRIGGER, port: capName.get(`${e.node} ${e.port}`)! }; // capture
  };

  const edges: Edge[] = [];
  // The per-chunk result → return.value.
  edges.push({ from: fromInBody(region.valueFrom), to: { node: BODY_RETURN, port: "value" } });
  // Every edge feeding a member, rewired to its in-body source.
  for (const e of workflow.edges) {
    if (!memberSet.has(e.to.node)) continue;
    edges.push({ from: fromInBody(e.from), to: e.to });
  }

  return { id: `__region:${region.eachId}`, nodes, edges };
}

export { BODY_TRIGGER, BODY_RETURN };
