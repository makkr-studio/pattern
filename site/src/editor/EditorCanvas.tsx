import { useRef, useState } from "react";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { MiniNodeBody, miniNodeHeight, NODE_W, portAnchor } from "../graph/MiniOpNode";
import { edgePath, graphBounds } from "../graph/geometry";
import { categoryOfType, categoryStyle, humanizeOp } from "../lib/categories";
import { portColor, type PortKind } from "../lib/format";
import { ParticleOverlay } from "./run/ParticleOverlay";
import type { Quest } from "./quest/controller";
import type { RunState } from "./run/engine";
import type { MiniGraph, MiniNodeRuntime, MiniNodeSpec } from "../graph/types";

interface WireDrag {
  fromNode: string;
  fromPort: string;
  kind: PortKind;
  x: number;
  y: number;
}

type Positions = Record<string, { x: number; y: number }>;

const HIT = 26; // generous drop radius (canvas units) onto an input port
const GRAB = 28; // generous output-port grab handle

/**
 * The interactive graph. Drag a node from the palette onto the canvas to place
 * it, drag from an output port to an input port to wire it, and drag a placed
 * node around to reposition it. Wrong connections are explained. During a run it
 * decorates nodes, lights edges, and streams particles.
 */
export function EditorCanvas({ quest, run }: { quest: Quest; run: RunState }) {
  const goal = quest.level.goal;
  const B = graphBounds(goal);
  const running = quest.status !== "building";
  const step = quest.step;
  const innerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<WireDrag | null>(null);
  const dragRef = useRef<WireDrag | null>(null);
  dragRef.current = drag;
  const [positions, setPositions] = useState<Positions>({});

  const posOf = (id: string): { x: number; y: number } => positions[id] ?? goal.nodes.find((n) => n.id === id)!.pos;
  const effGraph: MiniGraph = { nodes: goal.nodes.map((n) => ({ ...n, pos: posOf(n.id) })), edges: goal.edges };

  const wireSpec = step?.kind === "wire" ? goal.edges.find((e) => e.id === step.wireEdge) : undefined;
  const placeTarget = step?.kind === "place" ? step.placeNode : undefined;
  const canWire = !running && step?.kind === "wire";

  const runtimeFor = (id: string): MiniNodeRuntime => {
    if (running) return { replay: run.nodeState[id] ?? "pending" };
    const glow: string[] = [];
    if (wireSpec?.from.node === id) glow.push(wireSpec.from.port);
    if (wireSpec?.to.node === id) glow.push(wireSpec.to.port);
    const wired = goal.edges.filter((e) => quest.wired.has(e.id) && e.to.node === id).map((e) => e.to.port);
    return { glow, wired };
  };

  const clientToCanvas = (clientX: number, clientY: number) => {
    const el = innerRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: (clientX - r.left) / (r.width / B.width) + B.minX, y: (clientY - r.top) / (r.height / B.height) + B.minY };
  };

  // ── Wire dragging (output port → input port) ────────────────────────────
  const onWireMove = (e: PointerEvent) => {
    const p = clientToCanvas(e.clientX, e.clientY);
    setDrag((d) => (d ? { ...d, x: p.x, y: p.y } : d));
  };

  const nearestInput = (p: { x: number; y: number }) => {
    let best: { node: string; port: string; kind: PortKind; d: number } | null = null;
    for (const n of effGraph.nodes) {
      if (!quest.placed.has(n.id)) continue;
      for (const port of [...(n.configInputs ?? []), ...n.inputs]) {
        const a = portAnchor(n, port.name, "in");
        const dist = Math.hypot(n.pos.x + a.x - p.x, n.pos.y + a.y - p.y);
        if (dist < HIT && (!best || dist < best.d)) best = { node: n.id, port: port.name, kind: port.kind, d: dist };
      }
    }
    return best;
  };

  const onWireUp = (e: PointerEvent) => {
    window.removeEventListener("pointermove", onWireMove);
    const d = dragRef.current;
    setDrag(null);
    dragRef.current = null;
    if (!d) return;
    const target = nearestInput(clientToCanvas(e.clientX, e.clientY));
    if (!target) {
      quest.flagInvalid("Release on the glowing input port to connect.");
      return;
    }
    const goalEdge = goal.edges.find((ed) => ed.from.node === d.fromNode && ed.from.port === d.fromPort && ed.to.node === target.node && ed.to.port === target.port);
    if (goalEdge && goalEdge.id === step?.wireEdge) {
      quest.tryWire(goalEdge.id);
      return;
    }
    if (target.kind !== d.kind) {
      quest.flagInvalid(`A ${d.kind} port only links to a ${target.kind} port. Match the colors.`);
      return;
    }
    quest.flagInvalid(wireSpec ? `This step wires ${wireSpec.from.port} into ${wireSpec.to.port}.` : "Not the connection this step needs.");
  };

  const startWire = (e: React.PointerEvent, fromNode: string, fromPort: string, kind: PortKind) => {
    if (!canWire) return;
    e.preventDefault();
    e.stopPropagation();
    const p = clientToCanvas(e.clientX, e.clientY);
    const d: WireDrag = { fromNode, fromPort, kind, x: p.x, y: p.y };
    setDrag(d);
    dragRef.current = d;
    window.addEventListener("pointermove", onWireMove);
    window.addEventListener("pointerup", onWireUp, { once: true });
  };

  // ── Node dragging (reposition, just for the itch of it) ─────────────────
  const startNodeDrag = (e: React.PointerEvent, nodeId: string) => {
    if (running) return;
    e.preventDefault();
    const start = clientToCanvas(e.clientX, e.clientY);
    const base = posOf(nodeId);
    const move = (ev: PointerEvent) => {
      const p = clientToCanvas(ev.clientX, ev.clientY);
      setPositions((prev) => ({ ...prev, [nodeId]: { x: base.x + (p.x - start.x), y: base.y + (p.y - start.y) } }));
    };
    const up = () => window.removeEventListener("pointermove", move);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  return (
    <div className="grid h-full w-full place-items-center overflow-hidden">
      <div ref={innerRef} className="scale-[0.44] sm:scale-[0.58] md:scale-[0.7] lg:scale-[0.8]" style={{ position: "relative", width: B.width, height: B.height, transformOrigin: "center" }}>
        {/* Wires + particles (under the nodes) */}
        <svg aria-hidden width={B.width} height={B.height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <g transform={`translate(${-B.minX}, ${-B.minY})`}>
            {goal.edges.map((e) => {
              if (!quest.wired.has(e.id)) return null;
              const d = edgePath(effGraph, e);
              const color = portColor(e.kind);
              const lit = running && run.edgeLit[e.id];
              return (
                <path
                  key={e.id}
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={lit ? 3 : 2}
                  strokeLinecap="round"
                  strokeDasharray={e.kind === "control" ? "4 4" : undefined}
                  opacity={running && !lit ? 0.25 : 0.9}
                  style={{ filter: lit ? `drop-shadow(0 0 6px ${color})` : undefined, transition: "opacity 160ms, stroke-width 160ms, filter 160ms" }}
                />
              );
            })}
            {running && run.streamFlowing && goal.edges.some((e) => e.kind === "stream") && (
              <ParticleOverlay graph={effGraph} edgeId={goal.edges.find((e) => e.kind === "stream")!.id} />
            )}
          </g>
        </svg>

        {/* Placed nodes (draggable) */}
        {goal.nodes.map((n) => {
          if (!quest.placed.has(n.id)) return null;
          const p = posOf(n.id);
          const isWireTarget = canWire && wireSpec?.to.node === n.id;
          return (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 340, damping: 22 }}
              onPointerDown={(e) => startNodeDrag(e, n.id)}
              style={{ position: "absolute", left: p.x - B.minX, top: p.y - B.minY, cursor: running ? "default" : "grab", touchAction: "none" }}
            >
              {isWireTarget && (
                <span className="absolute -inset-2 rounded-2xl" style={{ border: "2px solid var(--color-neon-cyan)", boxShadow: "0 0 18px color-mix(in srgb, var(--color-neon-cyan) 50%, transparent)", animation: "pulse 1.4s ease-in-out infinite" }} />
              )}
              <MiniNodeBody spec={n} {...runtimeFor(n.id)} />
            </motion.div>
          );
        })}

        {/* Output-port grab handles (only while wiring) */}
        {canWire &&
          goal.nodes.map((n) => {
            if (!quest.placed.has(n.id)) return null;
            const p = posOf(n.id);
            return n.outputs.map((port) => {
              const a = portAnchor(n, port.name, "out");
              const isSource = wireSpec?.from.node === n.id && wireSpec.from.port === port.name;
              return (
                <div
                  key={`${n.id}.${port.name}`}
                  onPointerDown={(e) => startWire(e, n.id, port.name, port.kind)}
                  title={`${port.name} (${port.kind})`}
                  style={{
                    position: "absolute",
                    left: p.x + a.x - B.minX - GRAB / 2,
                    top: p.y + a.y - B.minY - GRAB / 2,
                    width: GRAB,
                    height: GRAB,
                    borderRadius: "50%",
                    cursor: "crosshair",
                    touchAction: "none",
                    zIndex: 6,
                    boxShadow: isSource ? `0 0 0 3px color-mix(in srgb, ${portColor(port.kind)} 40%, transparent)` : undefined,
                    animation: isSource ? "pulse 1.4s ease-in-out infinite" : undefined,
                  }}
                />
              );
            });
          })}

        {/* The wire being dragged (over the nodes) */}
        {drag && (
          <svg aria-hidden width={B.width} height={B.height} style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none", zIndex: 7 }}>
            <g transform={`translate(${-B.minX}, ${-B.minY})`}>
              <path d={dragPath(effGraph, drag)} fill="none" stroke={portColor(drag.kind)} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="6 5" style={{ filter: `drop-shadow(0 0 5px ${portColor(drag.kind)})` }} />
            </g>
          </svg>
        )}

        {/* Drop slot for the next node (visual target; placement is drag-only) */}
        {placeTarget && <DropSlot node={goal.nodes.find((n) => n.id === placeTarget)!} bounds={B} />}
      </div>
    </div>
  );
}

function dragPath(graph: MiniGraph, d: WireDrag): string {
  const from = graph.nodes.find((n) => n.id === d.fromNode);
  if (!from) return "";
  const a = portAnchor(from, d.fromPort, "out");
  const x1 = from.pos.x + a.x;
  const y1 = from.pos.y + a.y;
  const dx = Math.max(40, Math.abs(d.x - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${d.x - dx} ${d.y}, ${d.x} ${d.y}`;
}

function DropSlot({ node, bounds }: { node: MiniNodeSpec; bounds: ReturnType<typeof graphBounds> }) {
  const cat = categoryStyle(categoryOfType(node.op));
  const h = miniNodeHeight(node);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="pointer-events-none absolute grid place-items-center rounded-xl text-center"
      style={{
        left: node.pos.x - bounds.minX,
        top: node.pos.y - bounds.minY,
        width: NODE_W,
        height: h,
        border: `2px dashed ${cat.border}`,
        background: `color-mix(in srgb, ${cat.color} 8%, transparent)`,
        animation: "pulse 1.6s ease-in-out infinite",
      }}
    >
      <span className="flex flex-col items-center gap-1 text-[11px]" style={{ color: cat.color }}>
        <Plus size={16} />
        <span className="font-medium">{node.title ?? humanizeOp(node.op)}</span>
        <span className="text-muted">drop here</span>
      </span>
    </motion.div>
  );
}
