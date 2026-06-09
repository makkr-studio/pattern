/**
 * Pattern — the boundary config "resolve phase".
 *
 * Boundary ops may declare `configInputs` (e.g. `boundary.http.request` →
 * method/path/port). A value edge into one of these feeds that config field, but
 * the value is needed at *registration* time (the host wires routing before any
 * request), not per run. So the engine evaluates the **backward-closure of those
 * config ports** once at registration — a pure sub-graph of sources/transforms
 * (`core.env`, `core.const.*`, string/object ops…) — freezes the results into
 * config, and drops the config edges. The remaining workflow is the runtime graph.
 *
 * Evaluation reuses the scheduler: we synthesize a tiny workflow (the closure +
 * a manual trigger + a return out-gate collecting the source values) and run it.
 * Rule that keeps it sound: the closure must contain no triggers and nothing
 * reachable from a trigger — config can't depend on the request.
 */

import { configInputEdges, incomingEdges, reachableFrom } from "./graph.js";
import type { OpRegistry } from "./registry.js";
import { runWorkflow, type RunDeps } from "./scheduler/run.js";
import { ANONYMOUS, type Edge, type EdgeEndpoint, type Workflow } from "./types.js";

const RESOLVE_TRIGGER = "__resolve_trigger__";
const RESOLVE_OUT = "__resolve_out__";

/** Backward-reachable set from `starts`, following incoming edges. */
function backwardClosure(workflow: Workflow, starts: string[]): Set<string> {
  const set = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop()!;
    if (set.has(id)) continue;
    set.add(id);
    for (const e of incomingEdges(workflow, id)) if (!set.has(e.from.node)) stack.push(e.from.node);
  }
  return set;
}

const sourceKey = (ep: EdgeEndpoint): string => `${ep.node}__${ep.port}`;

/**
 * Resolve a workflow's boundary config ports. Returns a concrete workflow with
 * config values frozen in and config edges removed; returns the input unchanged
 * when there are no config ports.
 */
export async function resolveBoundaryConfig(
  input: Workflow,
  ops: OpRegistry,
  deps: RunDeps,
): Promise<Workflow> {
  const cfgEdges = configInputEdges(input, ops);
  if (cfgEdges.length === 0) return input;

  // The config sub-graph: everything feeding the config ports.
  const closure = backwardClosure(
    input,
    cfgEdges.map((e) => e.from.node),
  );

  // Soundness: the closure must be pure config — no triggers, nothing reachable
  // from a trigger (config cannot depend on the per-request data).
  const runtimeNodes = new Set<string>();
  for (const node of input.nodes) {
    if (ops.get(node.op)?.boundary === "trigger") {
      for (const id of reachableFrom(input, node.id).nodes) runtimeNodes.add(id);
    }
  }
  for (const id of closure) {
    const node = input.nodes.find((n) => n.id === id)!;
    if (ops.get(node.op)?.boundary === "trigger") {
      throw new Error(`config of "${input.id}" depends on trigger "${id}" — config ports can't be fed by a boundary`);
    }
    if (runtimeNodes.has(id)) {
      throw new Error(`config of "${input.id}" depends on runtime node "${id}" — config ports must be fed by pure sources (e.g. core.env, core.const.*)`);
    }
  }

  // Distinct (node, port) sources, collected via a synthetic return out-gate.
  const sources: EdgeEndpoint[] = [];
  const seen = new Set<string>();
  for (const e of cfgEdges) {
    const k = sourceKey(e.from);
    if (!seen.has(k)) {
      seen.add(k);
      sources.push(e.from);
    }
  }

  const closureNodes = input.nodes.filter((n) => closure.has(n.id));
  const closureEdges = input.edges.filter((e) => closure.has(e.from.node) && closure.has(e.to.node));
  const synthetic: Workflow = {
    id: `__resolve_${input.id}`,
    nodes: [
      ...closureNodes,
      { id: RESOLVE_TRIGGER, op: "boundary.manual" },
      { id: RESOLVE_OUT, op: "boundary.return.named", config: { inputs: sources.map(sourceKey) } },
    ],
    edges: [
      ...closureEdges,
      { from: { node: RESOLVE_TRIGGER, port: "out" }, to: { node: RESOLVE_OUT, port: "in" } },
      ...sources.map((s): Edge => ({ from: s, to: { node: RESOLVE_OUT, port: sourceKey(s) } })),
    ],
  };

  const result = await runWorkflow(deps, {
    workflow: synthetic,
    triggerNodeId: RESOLVE_TRIGGER,
    input: {},
    principal: ANONYMOUS,
  });
  if (result.status === "error") {
    const msg = result.error instanceof Error ? result.error.message : String(result.error);
    throw new Error(`config resolution failed for workflow "${input.id}": ${msg}`);
  }
  const values = result.outputs[RESOLVE_OUT] ?? {};

  // Freeze resolved values into config; drop the config edges (config sub-graph
  // nodes remain in the doc but become runtime-orphans — never executed per run).
  const dropped = new Set(cfgEdges);
  return {
    ...input,
    nodes: input.nodes.map((n) => {
      const forNode = cfgEdges.filter((e) => e.to.node === n.id);
      if (forNode.length === 0) return n;
      const config: Record<string, unknown> = { ...((n.config as object) ?? {}) };
      for (const e of forNode) config[e.to.port] = values[sourceKey(e.from)];
      return { ...n, config };
    }),
    edges: input.edges.filter((e) => !dropped.has(e)),
  };
}

/** Does this workflow use any boundary config ports (needs the async resolve phase)? */
export function hasConfigPorts(workflow: Workflow, ops: OpRegistry): boolean {
  return configInputEdges(workflow, ops).length > 0;
}
