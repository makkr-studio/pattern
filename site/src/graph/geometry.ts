import { miniNodeHeight, NODE_W, portAnchor } from "./MiniOpNode";
import type { MiniEdgeSpec, MiniGraph } from "./types";

export interface Bounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** The bounding box of a graph's nodes, padded. */
export function graphBounds(graph: MiniGraph, pad = 40): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of graph.nodes) {
    minX = Math.min(minX, n.pos.x);
    minY = Math.min(minY, n.pos.y);
    maxX = Math.max(maxX, n.pos.x + NODE_W);
    maxY = Math.max(maxY, n.pos.y + miniNodeHeight(n));
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, width: 0, height: 0 };
  return { minX: minX - pad, minY: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

export interface Cubic {
  x1: number;
  y1: number;
  cx1: number;
  cy1: number;
  cx2: number;
  cy2: number;
  x2: number;
  y2: number;
}

/** The cubic-bezier control points for an edge (absolute graph coords). */
export function edgeCubic(graph: MiniGraph, e: MiniEdgeSpec): Cubic | null {
  const from = graph.nodes.find((n) => n.id === e.from.node);
  const to = graph.nodes.find((n) => n.id === e.to.node);
  if (!from || !to) return null;
  const a = portAnchor(from, e.from.port, "out");
  const b = portAnchor(to, e.to.port, "in");
  const x1 = from.pos.x + a.x;
  const y1 = from.pos.y + a.y;
  const x2 = to.pos.x + b.x;
  const y2 = to.pos.y + b.y;
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return { x1, y1, cx1: x1 + dx, cy1: y1, cx2: x2 - dx, cy2: y2, x2, y2 };
}

/** A cubic-bezier SVG path between an edge's anchors, shaped like xyflow's default. */
export function edgePath(graph: MiniGraph, e: MiniEdgeSpec): string {
  const c = edgeCubic(graph, e);
  if (!c) return "";
  return `M ${c.x1} ${c.y1} C ${c.cx1} ${c.cy1}, ${c.cx2} ${c.cy2}, ${c.x2} ${c.y2}`;
}

/** A tiny deterministic 0..1 from a string (for staggering animations by id). */
export function hashUnit(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return h / 997;
}
