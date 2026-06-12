/**
 * A READ-ONLY workflow canvas for docs embeds — the admin's graph language
 * (port-kind colors, glass nodes, dashed control edges) without any editing.
 * Layout + flow-building are a trimmed copy of the admin editor's graph.ts;
 * the node is deliberately minimal (title, type, port handles, comment).
 * Loaded lazily so xyflow stays out of the reading bundle.
 */

import React, { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge as RFEdge,
  type Node as RFNode,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { OpInfo, PortInfo } from "../../shared/types";

export interface WorkflowDocLite {
  id?: string;
  name?: string;
  nodes: Array<{
    id: string;
    op: string;
    title?: string;
    comment?: string;
    config?: Record<string, unknown>;
    ui?: { x: number; y: number };
  }>;
  edges: Array<{ from: { node: string; port: string }; to: { node: string; port: string } }>;
}

type OpMap = Map<string, OpInfo>;

const CONTROL_IN = "in";
const CONTROL_OUT = "out";
const FALLBACK: PortInfo["kind"] = "value";

interface NodeData extends Record<string, unknown> {
  op: string;
  title?: string;
  comment?: string;
  inputs: PortInfo[];
  outputs: PortInfo[];
  boundary?: "trigger" | "outgate";
}

/** Ports = the op's declared ports ∪ ports referenced by edges (dynamic arity). */
function handlesFor(nodeId: string, op: OpInfo | undefined, doc: WorkflowDocLite) {
  const inputs = new Map<string, PortInfo>();
  const outputs = new Map<string, PortInfo>();
  for (const p of op?.inputs ?? []) inputs.set(p.name, p);
  for (const p of op?.configInputs ?? []) inputs.set(p.name, p);
  for (const p of op?.outputs ?? []) outputs.set(p.name, p);
  for (const name of op?.controlOut ?? []) outputs.set(name, { name, kind: "control" });
  for (const e of doc.edges) {
    if (e.to.node === nodeId && !inputs.has(e.to.port)) {
      inputs.set(e.to.port, { name: e.to.port, kind: e.to.port === CONTROL_IN ? "control" : FALLBACK });
    }
    if (e.from.node === nodeId && !outputs.has(e.from.port)) {
      outputs.set(e.from.port, { name: e.from.port, kind: e.from.port === CONTROL_OUT ? "control" : FALLBACK });
    }
  }
  // Only render ports that are wired or declared — keep embed nodes quiet.
  const wiredIn = new Set(doc.edges.filter((e) => e.to.node === nodeId).map((e) => e.to.port));
  const wiredOut = new Set(doc.edges.filter((e) => e.from.node === nodeId).map((e) => e.from.port));
  return {
    inputs: [...inputs.values()].filter((p) => wiredIn.has(p.name) || p.required),
    outputs: [...outputs.values()].filter((p) => wiredOut.has(p.name)),
  };
}

function portColor(kind: PortInfo["kind"]): string {
  return kind === "value"
    ? "var(--color-port-value)"
    : kind === "stream"
      ? "var(--color-port-stream)"
      : "var(--color-port-control)";
}

function edgeStyle(kind: PortInfo["kind"]): React.CSSProperties {
  return { stroke: portColor(kind), strokeWidth: 2, strokeDasharray: kind === "control" ? "4 4" : undefined };
}

/** Longest-path columns + stacked rows — enough to read a pipeline. */
function autoLayout(doc: WorkflowDocLite): Map<string, { x: number; y: number }> {
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
      if ((depth.get(e.to.node) ?? -1) < d + 1) {
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
    pos.set(n.id, { x: 40 + d * 260, y: 40 + row * 150 });
  }
  return pos;
}

function DocsOpNode({ data }: NodeProps<RFNode<NodeData>>) {
  const rows = Math.max(data.inputs.length, data.outputs.length);
  return (
    <div
      className="node-surface rounded-xl border text-[11px] hairline"
      style={{ minWidth: 170, borderColor: data.boundary ? "var(--color-port-control)" : undefined }}
    >
      <div className="border-b px-2.5 py-1.5 hairline">
        <div className="font-medium leading-tight" style={{ fontSize: 12 }}>
          {data.title ?? data.op}
        </div>
        <div className="font-mono text-[9.5px] text-muted">{data.op}</div>
      </div>
      <div className="relative px-2.5 py-1.5" style={{ minHeight: rows * 18 }}>
        {data.inputs.map((p, i) => (
          <div key={p.name} className="absolute left-0 flex items-center gap-1.5" style={{ top: 8 + i * 18 }}>
            <Handle
              type="target"
              id={p.name}
              position={Position.Left}
              isConnectable={false}
              style={{ position: "relative", transform: "none", width: 8, height: 8, border: "none", background: portColor(p.kind), left: -4 }}
            />
            <span className="text-muted">{p.name}</span>
          </div>
        ))}
        {data.outputs.map((p, i) => (
          <div key={p.name} className="absolute right-0 flex items-center gap-1.5" style={{ top: 8 + i * 18 }}>
            <span className="text-muted">{p.name}</span>
            <Handle
              type="source"
              id={p.name}
              position={Position.Right}
              isConnectable={false}
              style={{ position: "relative", transform: "none", width: 8, height: 8, border: "none", background: portColor(p.kind), right: -4 }}
            />
          </div>
        ))}
      </div>
      {data.comment && <div className="border-t px-2.5 py-1 text-[10px] text-muted hairline">{data.comment}</div>}
    </div>
  );
}

const nodeTypes = { docsOp: DocsOpNode };

export default function WorkflowGraph({ doc, ops }: { doc: WorkflowDocLite; ops: OpInfo[] }) {
  const { nodes, edges } = useMemo(() => {
    const opMap: OpMap = new Map(ops.map((o) => [o.type, o]));
    const layout = autoLayout(doc);
    const nodes: RFNode<NodeData>[] = doc.nodes.map((n) => {
      const op = opMap.get(n.op);
      const { inputs, outputs } = handlesFor(n.id, op, doc);
      return {
        id: n.id,
        type: "docsOp",
        position: n.ui ?? layout.get(n.id) ?? { x: 0, y: 0 },
        data: { op: n.op, title: n.title, comment: n.comment, inputs, outputs, boundary: op?.boundary },
        draggable: false,
        connectable: false,
        selectable: false,
      };
    });
    const kindOf = (nodeId: string, port: string): PortInfo["kind"] => {
      const node = doc.nodes.find((x) => x.id === nodeId);
      const op = node && opMap.get(node.op);
      const found = op?.outputs.find((p) => p.name === port);
      if (found) return found.kind;
      if (port === CONTROL_OUT || op?.controlOut.includes(port)) return "control";
      return FALLBACK;
    };
    const edges: RFEdge[] = doc.edges.map((e, i) => {
      const kind = kindOf(e.from.node, e.from.port);
      return {
        id: `e${i}`,
        source: e.from.node,
        target: e.to.node,
        sourceHandle: e.from.port,
        targetHandle: e.to.port,
        type: "default",
        animated: kind === "stream",
        style: edgeStyle(kind),
        focusable: false,
      };
    });
    return { nodes, edges };
  }, [doc, ops]);

  return (
    <div className="glass my-5 overflow-hidden rounded-2xl" style={{ height: Math.min(460, 150 + doc.nodes.length * 40) }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--hairline)" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
