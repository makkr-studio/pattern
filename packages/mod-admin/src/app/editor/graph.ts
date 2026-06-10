import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import type { OpInfo, PortInfo, WorkflowDoc } from "@pattern/admin-sdk";

export type OpMap = Map<string, OpInfo>;

/** A node's execution state at the replay scrubber's position (§15.1). */
export type ReplayState = "pending" | "running" | "ok" | "error" | "skipped";

/** The implicit control ports every op exposes (mirrors core's CONTROL_IN/OUT). */
export const CONTROL_IN = "in";
export const CONTROL_OUT = "out";

export interface OpNodeData extends Record<string, unknown> {
  op: string;
  title?: string;
  comment?: string;
  /** The op's description (markdown) — surfaced as a node tooltip. */
  description?: string;
  config: Record<string, unknown>;
  inputs: PortInfo[];
  outputs: PortInfo[];
  /** Registration-time config ports (boundary ops) — wired like value inputs. */
  configInputs: PortInfo[];
  /** Declared named control-outs (control-flow ops: branch/switch/…). */
  controlOuts: string[];
  boundary?: "trigger" | "outgate";
  /** The node id of this boundary's paired partner (triggers ↔ out-gates are
   *  created and deleted together — §7). Persisted as `ui.pair`. */
  pairId?: string;
  /** Set only on replay canvases — drives the node's status treatment. */
  replay?: ReplayState;
}

const KIND_FALLBACK: PortInfo["kind"] = "value";

/** Ports for a node = the op's default ports ∪ any ports referenced by edges
 *  (so configured dynamic-arity ports that are wired still render handles). */
function handlesFor(
  nodeId: string,
  op: OpInfo | undefined,
  doc: WorkflowDoc,
): { inputs: PortInfo[]; outputs: PortInfo[]; configInputs: PortInfo[]; controlOuts: string[] } {
  const inputs = new Map<string, PortInfo>();
  const outputs = new Map<string, PortInfo>();
  const configInputs = new Map<string, PortInfo>();
  const controlOuts = op?.controlOut ?? [];
  for (const p of op?.inputs ?? []) inputs.set(p.name, p);
  for (const p of op?.outputs ?? []) outputs.set(p.name, p);
  for (const p of op?.configInputs ?? []) configInputs.set(p.name, p);
  for (const e of doc.edges) {
    if (e.to.node === nodeId && !inputs.has(e.to.port) && !configInputs.has(e.to.port) && e.to.port !== CONTROL_IN) {
      inputs.set(e.to.port, { name: e.to.port, kind: KIND_FALLBACK });
    }
    if (e.from.node === nodeId && !outputs.has(e.from.port) && !controlOuts.includes(e.from.port) && e.from.port !== CONTROL_OUT) {
      outputs.set(e.from.port, { name: e.from.port, kind: KIND_FALLBACK });
    }
  }
  return {
    inputs: [...inputs.values()],
    outputs: [...outputs.values()],
    configInputs: [...configInputs.values()],
    controlOuts,
  };
}

/** Resolve the kind of an output port for edge styling. */
export function outputKind(nodeId: string, port: string, doc: WorkflowDoc, opMap: OpMap): PortInfo["kind"] {
  const node = doc.nodes.find((n) => n.id === nodeId);
  const op = node && opMap.get(node.op);
  const found = op?.outputs.find((p) => p.name === port);
  if (found) return found.kind;
  if (port === CONTROL_OUT || op?.controlOut.includes(port)) return "control";
  return KIND_FALLBACK;
}

/** Resolve a port (name + dir) on an op to its info, honoring the implicit
 *  control ports and the "declared port shadows control" rule from core. */
export function portOn(op: OpInfo | undefined, port: string, dir: "in" | "out"): PortInfo | undefined {
  if (!op) return undefined;
  if (dir === "in") {
    const declared = op.inputs.find((p) => p.name === port) ?? op.configInputs.find((p) => p.name === port);
    if (declared) return declared;
    if (port === CONTROL_IN) return { name: CONTROL_IN, kind: "control" };
    return undefined;
  }
  const declared = op.outputs.find((p) => p.name === port);
  if (declared) return declared;
  if (port === CONTROL_OUT || op.controlOut.includes(port)) return { name: port, kind: "control" };
  return undefined;
}

/** Resolve a port on a *canvas node's data* (used by live connection checks).
 *  Mirrors `portOn` but honors the node's rendered handles, including the
 *  implicit control ports the node actually shows. */
export function portOnNode(data: OpNodeData, port: string, dir: "in" | "out"): PortInfo | undefined {
  if (dir === "in") {
    const declared = data.inputs.find((p) => p.name === port) ?? data.configInputs.find((p) => p.name === port);
    if (declared) return declared;
    if (port === CONTROL_IN && data.boundary !== "trigger") return { name: CONTROL_IN, kind: "control" };
    return undefined;
  }
  const declared = data.outputs.find((p) => p.name === port);
  if (declared) return declared;
  if (port === CONTROL_OUT || data.controlOuts.includes(port)) return { name: port, kind: "control" };
  return undefined;
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
    pos.set(n.id, { x: 60 + d * 280, y: 60 + row * 160 });
  }
  return pos;
}

/** Convert a workflow document into React Flow nodes + edges. */
export function buildFlow(doc: WorkflowDoc, opMap: OpMap): { nodes: RFNode<OpNodeData>[]; edges: RFEdge[] } {
  const layout = autoLayout(doc);
  const nodes: RFNode<OpNodeData>[] = doc.nodes.map((n) => {
    const op = opMap.get(n.op);
    const { inputs, outputs, configInputs, controlOuts } = handlesFor(n.id, op, doc);
    const ui = n.ui ?? layout.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: "op",
      position: { x: ui.x, y: ui.y },
      data: {
        op: n.op,
        title: n.title,
        comment: n.comment,
        description: op?.description,
        config: (n.config as Record<string, unknown>) ?? {},
        inputs,
        outputs,
        configInputs,
        controlOuts,
        boundary: op?.boundary,
        pairId: typeof n.ui?.pair === "string" ? n.ui.pair : undefined,
      },
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
      // Fluid bezier curves — they fan out instead of stacking like step edges.
      type: "default",
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
      ui: {
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
        ...(n.data.pairId ? { pair: n.data.pairId } : {}),
      },
    })),
    edges: edges.map((e) => ({
      from: { node: e.source, port: e.sourceHandle ?? CONTROL_OUT },
      to: { node: e.target, port: e.targetHandle ?? CONTROL_IN },
    })),
  };
}
