import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import type { OpInfo, PortInfo, WorkflowDoc } from "@pattern-js/admin-sdk";

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
  /** Set ONLY on `type:"frame"` canvas nodes — the visual annotation box. */
  frame?: { label?: string; comment?: string; hue?: number };
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

/** Canvas node type for visual annotation frames (drawn under op nodes). */
export const FRAME_TYPE = "frame";

/** Canvas edge type for portal-rendered edges (named glyphs, no wire). */
export const PORTAL_TYPE = "portal";
const FRAME_PREFIX = "frame:";

const emptyOpData = (frame: { label?: string; comment?: string; hue?: number }): OpNodeData => ({
  op: "__frame__",
  config: {},
  inputs: [],
  outputs: [],
  configInputs: [],
  controlOuts: [],
  frame,
});

/** doc.frames → low-z, resizable canvas nodes (ids namespaced to avoid op-node collisions). */
export function frameFlowNodes(doc: WorkflowDoc): RFNode<OpNodeData>[] {
  return (doc.frames ?? []).map((f) => ({
    id: `${FRAME_PREFIX}${f.id}`,
    type: FRAME_TYPE,
    position: { x: f.x, y: f.y },
    width: f.w,
    height: f.h,
    zIndex: -10,
    data: emptyOpData({ label: f.label, comment: f.comment, hue: f.hue }),
  }));
}

/** A fresh frame canvas node (editor "Frame" button). */
export function makeFrameNode(rect: { x: number; y: number; w: number; h: number }, label = ""): RFNode<OpNodeData> {
  return {
    id: `${FRAME_PREFIX}${Math.random().toString(36).slice(2, 10)}`,
    type: FRAME_TYPE,
    position: { x: rect.x, y: rect.y },
    width: rect.w,
    height: rect.h,
    zIndex: -10,
    data: emptyOpData({ label }),
    selected: true,
  };
}

/** Convert a workflow document into React Flow nodes + edges. */
export function buildFlow(doc: WorkflowDoc, opMap: OpMap): { nodes: RFNode<OpNodeData>[]; edges: RFEdge[] } {
  const layout = autoLayout(doc);
  const opNodes: RFNode<OpNodeData>[] = doc.nodes.map((n) => {
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
    const portal = e.ui?.portal;
    return {
      id: `e${i}-${e.from.node}.${e.from.port}-${e.to.node}.${e.to.port}`,
      source: e.from.node,
      target: e.to.node,
      sourceHandle: e.from.port,
      targetHandle: e.to.port,
      // Fluid bezier curves — they fan out instead of stacking like step edges.
      // A `portal` annotation swaps the wire for paired named glyphs; the edge
      // (and everything derived from it) is untouched — it's a VIEW.
      type: portal ? PORTAL_TYPE : "default",
      animated: kind === "stream",
      data: { kind, ...(portal ? { portal } : {}), edgeUi: e.ui },
      style: edgeStyle(kind),
    };
  });
  return { nodes: [...frameFlowNodes(doc), ...opNodes], edges };
}

export function edgeStyle(kind: PortInfo["kind"]): React.CSSProperties {
  const color = kind === "value" ? "var(--color-port-value)" : kind === "stream" ? "var(--color-port-stream)" : "var(--color-port-control)";
  return { stroke: color, strokeWidth: 2, strokeDasharray: kind === "control" ? "4 4" : undefined };
}

/** Estimated rendered height of a node (mirrors OpNode's geometry). */
function nodeHeight(data: OpNodeData): number {
  const rows = Math.max(data.configInputs.length + data.inputs.length, data.outputs.length + data.controlOuts.length, 1);
  return 40 + rows * 22 + 12;
}

/**
 * Auto-tidy: longest-path layering (left → right along edges) with a few
 * barycenter passes to order each layer (crossing reduction), columns centered
 * vertically. Pure — returns new positions keyed by node id.
 */
export function tidyLayout(allNodes: RFNode<OpNodeData>[], edges: RFEdge[]): Map<string, { x: number; y: number }> {
  // Frames are annotation, not graph — tidy never moves them.
  const nodes = allNodes.filter((n) => n.type !== FRAME_TYPE);
  const X_GAP = 300;
  const Y_GAP = 48;

  // ── Layering: layer(v) = longest path from any source. Cycle-safe (skips
  // anything Kahn can't settle, which validation forbids anyway).
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const e of edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target) || e.source === e.target) continue;
    indeg.set(e.target, indeg.get(e.target)! + 1);
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e.target);
    (into.get(e.target) ?? into.set(e.target, []).get(e.target)!).push(e.source);
  }
  const layer = new Map<string, number>();
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  for (const id of queue) layer.set(id, 0);
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of out.get(u) ?? []) {
      layer.set(v, Math.max(layer.get(v) ?? 0, layer.get(u)! + 1));
      indeg.set(v, indeg.get(v)! - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  for (const n of nodes) if (!layer.has(n.id)) layer.set(n.id, 0);

  // ── Order within layers: start from current y (stable for the author),
  // then a few barycenter sweeps over predecessor/successor positions.
  const layers: string[][] = [];
  for (const n of nodes) (layers[layer.get(n.id)!] ??= []).push(n.id);
  const yNow = new Map(nodes.map((n) => [n.id, n.position.y] as const));
  for (const l of layers) l?.sort((a, b) => yNow.get(a)! - yNow.get(b)!);
  const pos = new Map<string, number>(); // index within its layer
  const reindex = () => layers.forEach((l) => l?.forEach((id, i) => pos.set(id, i)));
  reindex();
  for (let pass = 0; pass < 4; pass++) {
    const refs = pass % 2 === 0 ? into : out; // alternate sweep direction
    for (const l of layers) {
      l?.sort((a, b) => {
        const bary = (id: string) => {
          const r = refs.get(id) ?? [];
          return r.length ? r.reduce((s, p) => s + (pos.get(p) ?? 0), 0) / r.length : (pos.get(id) ?? 0);
        };
        return bary(a) - bary(b);
      });
      l?.forEach((id, i) => pos.set(id, i));
    }
  }

  // ── Coordinates: columns at fixed x, stacked with gaps, centered on the
  // tallest column so the graph reads as one band.
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const colHeights = layers.map((l) => (l ?? []).reduce((s, id) => s + nodeHeight(byId.get(id)!.data) + Y_GAP, -Y_GAP));
  const maxH = Math.max(0, ...colHeights);
  const result = new Map<string, { x: number; y: number }>();
  layers.forEach((l, li) => {
    let y = 80 + (maxH - (colHeights[li] ?? 0)) / 2;
    for (const id of l ?? []) {
      result.set(id, { x: 80 + li * X_GAP, y: Math.round(y) });
      y += nodeHeight(byId.get(id)!.data) + Y_GAP;
    }
  });
  return result;
}

/** Convert React Flow state back into a workflow document. */
export function toDoc(base: WorkflowDoc, nodes: RFNode<OpNodeData>[], edges: RFEdge[]): WorkflowDoc {
  const frames = nodes
    .filter((n) => n.type === FRAME_TYPE)
    .map((n) => ({
      id: n.id.startsWith(FRAME_PREFIX) ? n.id.slice(FRAME_PREFIX.length) : n.id,
      ...(n.data.frame?.label ? { label: n.data.frame.label } : {}),
      ...(n.data.frame?.comment ? { comment: n.data.frame.comment } : {}),
      ...(n.data.frame?.hue !== undefined ? { hue: n.data.frame.hue } : {}),
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      w: Math.round(n.width ?? n.measured?.width ?? 480),
      h: Math.round(n.height ?? n.measured?.height ?? 280),
    }));
  const opNodes = nodes.filter((n) => n.type !== FRAME_TYPE);
  return {
    ...base,
    ...(frames.length ? { frames } : { frames: undefined }),
    nodes: opNodes.map((n) => ({
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
    edges: edges.map((e) => {
      const prior = (e.data?.edgeUi ?? {}) as Record<string, unknown>;
      const portal = e.data?.portal as string | undefined;
      const ui = { ...prior, portal };
      if (ui.portal === undefined) delete ui.portal;
      return {
        from: { node: e.source, port: e.sourceHandle ?? CONTROL_OUT },
        to: { node: e.target, port: e.targetHandle ?? CONTROL_IN },
        ...(Object.keys(ui).length ? { ui } : {}),
      };
    }),
  };
}
