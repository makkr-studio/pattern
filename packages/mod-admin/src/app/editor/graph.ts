import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import type { OpInfo, PortInfo, WorkflowDoc } from "@pattern/admin-sdk";

export type OpMap = Map<string, OpInfo>;

/** A node's execution state at the replay scrubber's position (§15.1). */
export type ReplayState = "pending" | "running" | "ok" | "error" | "skipped";

export interface OpNodeData extends Record<string, unknown> {
  op: string;
  title?: string;
  comment?: string;
  /** The op's description (markdown) — surfaced as a node tooltip. */
  description?: string;
  config: Record<string, unknown>;
  inputs: PortInfo[];
  outputs: PortInfo[];
  boundary?: "trigger" | "outgate";
  /** Set only on replay canvases — drives the node's status treatment. */
  replay?: ReplayState;
}

const KIND_FALLBACK: PortInfo["kind"] = "value";

/** Ports for a node = the op's default ports ∪ any ports referenced by edges
 *  (so configured dynamic-arity ports that are wired still render handles). */
function handlesFor(nodeId: string, op: OpInfo | undefined, doc: WorkflowDoc): { inputs: PortInfo[]; outputs: PortInfo[] } {
  const inputs = new Map<string, PortInfo>();
  const outputs = new Map<string, PortInfo>();
  for (const p of op?.inputs ?? []) inputs.set(p.name, p);
  for (const p of op?.outputs ?? []) outputs.set(p.name, p);
  for (const e of doc.edges) {
    if (e.to.node === nodeId && !inputs.has(e.to.port)) inputs.set(e.to.port, { name: e.to.port, kind: KIND_FALLBACK });
    if (e.from.node === nodeId && !outputs.has(e.from.port)) outputs.set(e.from.port, { name: e.from.port, kind: KIND_FALLBACK });
  }
  return { inputs: [...inputs.values()], outputs: [...outputs.values()] };
}

/** Resolve the kind of an output port for edge styling. */
export function outputKind(nodeId: string, port: string, doc: WorkflowDoc, opMap: OpMap): PortInfo["kind"] {
  const node = doc.nodes.find((n) => n.id === nodeId);
  const op = node && opMap.get(node.op);
  const found = op?.outputs.find((p) => p.name === port);
  if (found) return found.kind;
  return port === "out" ? "control" : KIND_FALLBACK;
}

/** Simple layered auto-layout for nodes lacking a `ui` position. */
function autoLayout(doc: WorkflowDoc): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>();
  const indeg = new Map<string, number>();
  for (const n of doc.nodes) indeg.set(n.id, 0);
  for (const e of doc.edges) indeg.set(e.to.node, (indeg.get(e.to.node) ?? 0) + 1);
  const queue = doc.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  for (const id of queue) depth.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    for (const e of doc.edges.filter((e) => e.from.node === id)) {
      if (!depth.has(e.to.node) || (depth.get(e.to.node) ?? 0) < d + 1) {
        depth.set(e.to.node, d + 1);
        queue.push(e.to.node);
      }
    }
  }
  const perCol = new Map<number, number>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of doc.nodes) {
    const d = depth.get(n.id) ?? 0;
    const row = perCol.get(d) ?? 0;
    perCol.set(d, row + 1);
    pos.set(n.id, { x: 60 + d * 280, y: 60 + row * 140 });
  }
  return pos;
}

/** Convert a workflow document into React Flow nodes + edges. */
export function buildFlow(doc: WorkflowDoc, opMap: OpMap): { nodes: RFNode<OpNodeData>[]; edges: RFEdge[] } {
  const layout = autoLayout(doc);
  const nodes: RFNode<OpNodeData>[] = doc.nodes.map((n) => {
    const op = opMap.get(n.op);
    const { inputs, outputs } = handlesFor(n.id, op, doc);
    const ui = n.ui ?? layout.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: "op",
      position: { x: ui.x, y: ui.y },
      data: { op: n.op, title: n.title, comment: n.comment, description: op?.description, config: (n.config as Record<string, unknown>) ?? {}, inputs, outputs, boundary: op?.boundary },
    };
  });
  const edges: RFEdge[] = doc.edges.map((e, i) => {
    const kind = outputKind(e.from.node, e.from.port, doc, opMap);
    return {
      id: `e${i}-${e.from.node}.${e.from.port}-${e.to.node}.${e.to.port}`,
      source: e.from.node,
      target: e.to.node,
      sourceHandle: e.from.port,
      targetHandle: e.to.port,
      type: "smoothstep",
      animated: kind === "stream",
      data: { kind },
      style: edgeStyle(kind),
    };
  });
  return { nodes, edges };
}

export function edgeStyle(kind: PortInfo["kind"]): React.CSSProperties {
  const color = kind === "value" ? "var(--color-port-value)" : kind === "stream" ? "var(--color-port-stream)" : "var(--color-port-control)";
  return { stroke: color, strokeWidth: 2, strokeDasharray: kind === "control" ? "4 4" : undefined };
}

/** Convert React Flow state back into a workflow document. */
export function toDoc(base: WorkflowDoc, nodes: RFNode<OpNodeData>[], edges: RFEdge[]): WorkflowDoc {
  return {
    ...base,
    nodes: nodes.map((n) => ({
      id: n.id,
      op: n.data.op,
      title: n.data.title,
      comment: n.data.comment,
      config: n.data.config && Object.keys(n.data.config).length ? n.data.config : undefined,
      ui: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    })),
    edges: edges.map((e) => ({
      from: { node: e.source, port: e.sourceHandle ?? "out" },
      to: { node: e.target, port: e.targetHandle ?? "in" },
    })),
  };
}
