/**
 * Pattern — graph utilities shared by validation and the scheduler.
 *
 * These are pure functions over a `Workflow` + `OpRegistry`. Dynamic-arity ops
 * (e.g. `core.stream.split` → `out.0..n`) resolve their ports from parsed
 * config, so the port-resolving helpers take the node's parsed config.
 */

import { CONTROL_IN, CONTROL_OUT } from "./types.js";
import type {
  Edge,
  OpDefinition,
  PortKind,
  Ports,
  PortsDef,
  Workflow,
  WorkflowNode,
} from "./types.js";
import type { OpRegistry } from "./registry.js";

/** Resolve a possibly-dynamic ports declaration against parsed config. */
export function resolvePorts(def: PortsDef, config: unknown): Ports {
  return typeof def === "function" ? def(config ?? {}) : def;
}

/** Resolve the extra named control-out ports of an op against parsed config. */
export function resolveControlOuts(op: OpDefinition, config: unknown): string[] {
  if (!op.controlOut) return [];
  return typeof op.controlOut === "function" ? op.controlOut(config ?? {}) : op.controlOut;
}

/** Resolve an op's registration-time config-input ports against parsed config. */
export function resolveConfigInputs(op: OpDefinition, config: unknown): Ports {
  return op.configInputs ? resolvePorts(op.configInputs, config) : {};
}

/**
 * Edges that feed a boundary op's config-input port (the "resolve phase" inputs).
 * These are evaluated at registration and removed from the runtime workflow.
 */
export function configInputEdges(workflow: Workflow, ops: OpRegistry): Edge[] {
  const byId = nodeMap(workflow);
  return workflow.edges.filter((e) => {
    const node = byId.get(e.to.node);
    const op = node && ops.get(node.op);
    if (!op) return false;
    return Object.keys(resolveConfigInputs(op, node!.config)).includes(e.to.port);
  });
}

/** Index nodes by id. */
export function nodeMap(workflow: Workflow): Map<string, WorkflowNode> {
  const m = new Map<string, WorkflowNode>();
  for (const n of workflow.nodes) m.set(n.id, n);
  return m;
}

/**
 * The kind of a port in a given direction, accounting for the implicit control
 * ports `in` (input) and `out` (output) and any declared named control-outs.
 * Returns `undefined` if the named port does not exist on the op.
 *
 * A **declared** data port shadows the implicit control port of the same name:
 * stream ops legitimately call their data ports `in`/`out` (§6, §12), so a
 * declared `in`/`out` resolves to that data port, not the control port.
 */
export function portKindOf(
  op: OpDefinition,
  config: unknown,
  port: string,
  dir: "in" | "out",
): PortKind | undefined {
  if (dir === "in") {
    const declared = resolvePorts(op.inputs, config)[port]?.kind;
    if (declared) return declared;
    // Registration-time config ports (boundary ops) also accept value edges.
    if (op.configInputs) {
      const cfg = resolvePorts(op.configInputs, config)[port]?.kind;
      if (cfg) return cfg;
    }
    if (port === CONTROL_IN) return "control";
    return undefined;
  }
  // dir === "out"
  const declared = resolvePorts(op.outputs, config)[port]?.kind;
  if (declared) return declared;
  if (port === CONTROL_OUT) return "control";
  if (resolveControlOuts(op, config).includes(port)) return "control";
  return undefined;
}

/** Edges whose `to` endpoint is `nodeId`. */
export function incomingEdges(workflow: Workflow, nodeId: string): Edge[] {
  return workflow.edges.filter((e) => e.to.node === nodeId);
}

/** Edges whose `from` endpoint is `nodeId`. */
export function outgoingEdges(workflow: Workflow, nodeId: string): Edge[] {
  return workflow.edges.filter((e) => e.from.node === nodeId);
}

/** The single edge feeding `(nodeId, port)`, if any (value/stream inputs are single-source). */
export function edgeInto(workflow: Workflow, nodeId: string, port: string): Edge | undefined {
  return workflow.edges.find((e) => e.to.node === nodeId && e.to.port === port);
}

/** All edges feeding `(nodeId, port)` (control-in is multi-source / AND). */
export function edgesInto(workflow: Workflow, nodeId: string, port: string): Edge[] {
  return workflow.edges.filter((e) => e.to.node === nodeId && e.to.port === port);
}

/**
 * The subgraph of nodes reachable from `startId` by following edges forward.
 * A run executes only this subgraph (§7: one run = one trigger's reachable subgraph).
 */
export function reachableFrom(
  workflow: Workflow,
  startId: string,
): { nodes: Set<string>; edges: Edge[] } {
  const nodes = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop()!;
    if (nodes.has(id)) continue;
    nodes.add(id);
    for (const e of outgoingEdges(workflow, id)) {
      if (!nodes.has(e.to.node)) stack.push(e.to.node);
    }
  }
  const edges = workflow.edges.filter((e) => nodes.has(e.from.node) && nodes.has(e.to.node));
  return { nodes, edges };
}

/**
 * Detect a cycle among the given nodes/edges (all edge kinds count; v1 forbids
 * cycles, including across stream edges — §6). Returns the cycle path or null.
 */
export function detectCycle(nodeIds: Iterable<string>, edges: Edge[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (adj.has(e.from.node)) adj.get(e.from.node)!.push(e.to.node);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adj.keys()) color.set(id, WHITE);
  const path: string[] = [];

  const visit = (u: string): string[] | null => {
    color.set(u, GRAY);
    path.push(u);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GRAY) {
        // found back-edge: slice the cycle out of the current path
        const start = path.indexOf(v);
        return [...path.slice(start), v];
      }
      if (color.get(v) === WHITE) {
        const found = visit(v);
        if (found) return found;
      }
    }
    path.pop();
    color.set(u, BLACK);
    return null;
  };

  for (const id of adj.keys()) {
    if (color.get(id) === WHITE) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The subgraph the engine actually executes for a run started by `triggerNodeId`.
 *
 * It is the forward-reachable set from the trigger, **plus** the ancestors that
 * feed those nodes (e.g. `core.const.*` sources wired into a downstream op),
 * stopping at any *other* trigger node so dormant triggers and the parts unique
 * to them stay out of the run (§7: one run = one trigger's reachable subgraph).
 */
export function executionSubgraph(
  workflow: Workflow,
  triggerNodeId: string,
  ops: OpRegistry,
): { nodes: Set<string>; edges: Edge[] } {
  const byId = nodeMap(workflow);
  const forward = reachableFrom(workflow, triggerNodeId).nodes;
  const included = new Set(forward);
  const stack = [...forward];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of incomingEdges(workflow, id)) {
      const src = e.from.node;
      if (included.has(src)) continue;
      const op = ops.get(byId.get(src)?.op ?? "");
      // Don't pull in other dormant triggers (or anything only they feed).
      if (op?.boundary === "trigger" && src !== triggerNodeId) continue;
      included.add(src);
      stack.push(src);
    }
  }
  const edges = workflow.edges.filter((e) => included.has(e.from.node) && included.has(e.to.node));
  return { nodes: included, edges };
}

/** All trigger nodes in a workflow (boundary === "trigger"). */
export function findTriggerNodes(workflow: Workflow, ops: OpRegistry): WorkflowNode[] {
  return workflow.nodes.filter((n) => ops.get(n.op)?.boundary === "trigger");
}

/** All out-gate nodes in a workflow (boundary === "outgate"). */
export function findOutGateNodes(workflow: Workflow, ops: OpRegistry): WorkflowNode[] {
  return workflow.nodes.filter((n) => ops.get(n.op)?.boundary === "outgate");
}
