import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { MiniNodeBody, miniNodeHeight, NODE_W } from "../graph/MiniOpNode";
import { edgePath, graphBounds } from "../graph/geometry";
import { categoryOfType, categoryStyle, humanizeOp } from "../lib/categories";
import { portColor } from "../lib/format";
import { ParticleOverlay } from "./run/ParticleOverlay";
import type { Quest } from "./quest/controller";
import type { RunState } from "./run/engine";
import type { MiniNodeRuntime } from "../graph/types";

/**
 * The interactive graph: placed nodes + wired edges, with a pulsing drop-slot
 * for the next node and a click-to-connect target for the next wire. During a
 * run it decorates nodes with replay states, lights edges, and flows particles.
 */
export function EditorCanvas({ quest, run }: { quest: Quest; run: RunState }) {
  const goal = quest.level.goal;
  const B = graphBounds(goal);
  const running = quest.status !== "building";
  const step = quest.step;

  // Glows for the active wire step.
  const wireSpec = step?.kind === "wire" ? goal.edges.find((e) => e.id === step.wireEdge) : undefined;
  const placeTarget = step?.kind === "place" ? step.placeNode : undefined;

  const runtimeFor = (id: string): MiniNodeRuntime => {
    if (running) return { replay: run.nodeState[id] ?? "pending" };
    const glow: string[] = [];
    if (wireSpec?.from.node === id) glow.push(wireSpec.from.port);
    if (wireSpec?.to.node === id) glow.push(wireSpec.to.port);
    const wired = goal.edges.filter((e) => quest.wired.has(e.id) && e.to.node === id).map((e) => e.to.port);
    return { glow, wired };
  };

  return (
    <div className="grid w-full place-items-center overflow-hidden">
      <div className="scale-[0.44] sm:scale-[0.58] md:scale-[0.7] lg:scale-[0.8]" style={{ position: "relative", width: B.width, height: B.height, transformOrigin: "center" }}>
        {/* Wires */}
        <svg aria-hidden width={B.width} height={B.height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <g transform={`translate(${-B.minX}, ${-B.minY})`}>
            {goal.edges.map((e) => {
              if (!quest.wired.has(e.id)) return null;
              const d = edgePath(goal, e);
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
              <ParticleOverlay graph={goal} edgeId={goal.edges.find((e) => e.kind === "stream")!.id} />
            )}
          </g>
        </svg>

        {/* Placed nodes */}
        {goal.nodes.map((n) => {
          if (!quest.placed.has(n.id)) return null;
          const isWireTarget = !running && wireSpec?.to.node === n.id;
          return (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 340, damping: 22 }}
              style={{ position: "absolute", left: n.pos.x - B.minX, top: n.pos.y - B.minY, cursor: isWireTarget ? "pointer" : "default" }}
              onClick={isWireTarget ? () => quest.tryWire(wireSpec!.id) : undefined}
            >
              {isWireTarget && (
                <span
                  className="absolute -inset-2 rounded-2xl"
                  style={{ border: "2px solid var(--color-neon-cyan)", boxShadow: "0 0 18px color-mix(in srgb, var(--color-neon-cyan) 50%, transparent)", animation: "pulse 1.4s ease-in-out infinite" }}
                />
              )}
              <MiniNodeBody spec={n} {...runtimeFor(n.id)} />
            </motion.div>
          );
        })}

        {/* Drop slot for the next node */}
        {placeTarget && <DropSlot quest={quest} nodeId={placeTarget} bounds={B} />}
      </div>
    </div>
  );
}

function DropSlot({ quest, nodeId, bounds }: { quest: Quest; nodeId: string; bounds: ReturnType<typeof graphBounds> }) {
  const n = quest.level.goal.nodes.find((x) => x.id === nodeId);
  if (!n) return null;
  const cat = categoryStyle(categoryOfType(n.op));
  const h = miniNodeHeight(n);
  return (
    <motion.button
      type="button"
      onClick={() => quest.tryPlace(nodeId)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute grid place-items-center rounded-xl text-center"
      style={{
        left: n.pos.x - bounds.minX,
        top: n.pos.y - bounds.minY,
        width: NODE_W,
        height: h,
        border: `2px dashed ${cat.border}`,
        background: `color-mix(in srgb, ${cat.color} 8%, transparent)`,
        animation: "pulse 1.6s ease-in-out infinite",
        cursor: "pointer",
      }}
    >
      <span className="flex flex-col items-center gap-1 text-[11px]" style={{ color: cat.color }}>
        <Plus size={16} />
        <span className="font-medium">{n.title ?? humanizeOp(n.op)}</span>
        <span className="text-muted">click to add</span>
      </span>
    </motion.button>
  );
}
