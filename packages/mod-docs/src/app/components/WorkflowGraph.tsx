/**
 * A READ-ONLY workflow canvas for docs embeds, rendered in the SAME visual
 * language as the marketing site: glowing bezier wires over category-tinted
 * glass nodes (icons, schema-typed port dots, control notches). It's a plain
 * SVG layer (the site's StaticGraph) — no xyflow, no animation — fit to the
 * embed width, with a fullscreen view for big graphs. Loaded lazily.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import type { OpInfo, PortInfo } from "../../shared/types";
import { StaticGraph } from "../graph/StaticGraph";
import { graphBounds } from "../graph/geometry";
import type { MiniEdgeSpec, MiniGraph, MiniNodeSpec, MiniPort, PortKind } from "../graph/types";

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

const CONTROL_IN = "in";
const CONTROL_OUT = "out";

/** Longest-path columns + stacked rows — enough to read a pipeline. Spacing is
 *  sized for the (taller) site node so columns/rows don't collide. */
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
    pos.set(n.id, { x: 40 + d * 300, y: 40 + row * 210 });
  }
  return pos;
}

const toMiniPort = (p: PortInfo): MiniPort => ({ name: p.name, kind: p.kind, schemaType: p.dataType, required: p.required });

/** Build a static MiniGraph (site renderer's input) from a workflow doc + ops:
 *  only declared-required or wired ports show, config inputs stay separate (square
 *  dots), and each edge takes its source port's kind for color/dash. */
export function workflowToMiniGraph(doc: WorkflowDocLite, ops: OpInfo[]): MiniGraph {
  const opMap = new Map(ops.map((o) => [o.type, o]));
  const layout = autoLayout(doc);

  const nodes: MiniNodeSpec[] = doc.nodes.map((n) => {
    const op = opMap.get(n.op);
    const wiredIn = new Set(doc.edges.filter((e) => e.to.node === n.id).map((e) => e.to.port));
    const wiredOut = new Set(doc.edges.filter((e) => e.from.node === n.id).map((e) => e.from.port));

    const configInputs = (op?.configInputs ?? []).filter((p) => wiredIn.has(p.name) || p.required).map(toMiniPort);
    const inputs = (op?.inputs ?? []).filter((p) => wiredIn.has(p.name) || p.required).map(toMiniPort);
    // Edge-referenced inputs the op doesn't declare (dynamic arity).
    const declaredIn = new Set([...(op?.inputs ?? []), ...(op?.configInputs ?? [])].map((p) => p.name));
    for (const port of wiredIn) if (!declaredIn.has(port)) inputs.push({ name: port, kind: port === CONTROL_IN ? "control" : "value" });

    const outputs = (op?.outputs ?? []).filter((p) => wiredOut.has(p.name)).map(toMiniPort);
    const declaredOut = new Set([...(op?.outputs ?? []).map((p) => p.name), ...(op?.controlOut ?? [])]);
    for (const port of wiredOut) if (!declaredOut.has(port) && port !== CONTROL_OUT) outputs.push({ name: port, kind: "value" });
    const controlOuts = (op?.controlOut ?? []).filter((co) => wiredOut.has(co));

    return {
      id: n.id,
      op: n.op,
      title: n.title,
      boundary: op?.boundary,
      configInputs,
      inputs,
      outputs,
      controlOuts,
      pos: n.ui ?? layout.get(n.id) ?? { x: 0, y: 0 },
    };
  });

  const kindOf = (nodeId: string, port: string): PortKind => {
    const node = doc.nodes.find((x) => x.id === nodeId);
    const op = node && opMap.get(node.op);
    const found = op?.outputs.find((p) => p.name === port);
    if (found) return found.kind;
    if (port === CONTROL_OUT || op?.controlOut.includes(port)) return "control";
    return "value";
  };
  const edges: MiniEdgeSpec[] = doc.edges.map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to, kind: kindOf(e.from.node, e.from.port) }));

  return { nodes, edges };
}

/** Render a graph scaled to fit the available width (and an optional max height),
 *  never magnified past 1:1. Reserves the scaled height so layout stays correct. */
function GraphFit({ graph, maxHeight }: { graph: MiniGraph; maxHeight: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const b = graphBounds(graph);
  const scale = Math.min(1, w > 0 ? w / b.width : 1, maxHeight > 0 ? maxHeight / b.height : 1);
  return (
    <div ref={ref} className="flex w-full justify-center" style={{ height: b.height * scale }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top center", width: b.width, height: b.height }}>
        <StaticGraph graph={graph} />
      </div>
    </div>
  );
}

export default function WorkflowGraph({ doc, ops }: { doc: WorkflowDocLite; ops: OpInfo[] }) {
  const graph = useMemo(() => workflowToMiniGraph(doc, ops), [doc, ops]);
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [full]);

  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  return (
    <>
      <div className="glass relative my-5 overflow-hidden rounded-2xl p-5">
        <button
          type="button"
          onClick={() => setFull(true)}
          className="absolute right-2.5 top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/10"
          title="View fullscreen"
          aria-label="View workflow fullscreen"
        >
          <Maximize2 size={15} />
        </button>
        <GraphFit graph={graph} maxHeight={460} />
      </div>

      {full && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-6"
          style={{ background: "rgba(4,4,9,0.86)", backdropFilter: "blur(4px)" }}
          onClick={() => setFull(false)}
        >
          <button
            type="button"
            onClick={() => setFull(false)}
            className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10"
            aria-label="Close fullscreen"
            title="Close (Esc)"
          >
            <X size={20} />
          </button>
          <div className="max-h-full w-full max-w-[94vw] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <GraphFit graph={graph} maxHeight={vh * 0.86} />
          </div>
        </div>
      )}
    </>
  );
}
