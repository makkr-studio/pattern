import { type CSSProperties } from "react";
import { motion } from "motion/react";
import { MiniNodeBody } from "./MiniOpNode";
import { edgePath, graphBounds, hashUnit } from "./geometry";
import { portColor } from "../lib/format";
import type { MiniGraph, MiniNodeRuntime } from "./types";

/** Per-edge presentation override (drives the scroll-morph draw-in + run glow). */
export interface EdgeView {
  /** 0..1 how much of the wire is drawn (scroll-morph). Default 1. */
  drawn?: number;
  lit?: boolean;
  dim?: boolean;
  hidden?: boolean;
}

/**
 * Renders a MiniGraph as a plain layer: absolutely-positioned MiniNodeBody nodes
 * over an SVG of bezier wires. No xyflow, so the hero and scroll-morph stay light
 * and never pay for a canvas. `pulse` runs a travelling neon dash along each wire
 * (disable under reduced motion). Per-node and per-edge state is fully external.
 */
export function StaticGraph({
  graph,
  runtime,
  edges,
  pulse = false,
  nodeStyle,
  className,
  style,
}: {
  graph: MiniGraph;
  runtime?: Record<string, MiniNodeRuntime>;
  edges?: Record<string, EdgeView>;
  pulse?: boolean;
  /** Per-node wrapper style (e.g. opacity for scroll staging). */
  nodeStyle?: (id: string) => CSSProperties | undefined;
  className?: string;
  style?: CSSProperties;
}) {
  const b = graphBounds(graph);
  return (
    <div className={className} style={{ position: "relative", width: b.width, height: b.height, ...style }}>
      <svg
        aria-hidden
        width={b.width}
        height={b.height}
        style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
      >
        <g transform={`translate(${-b.minX}, ${-b.minY})`}>
          {graph.edges.map((e) => {
            const view = edges?.[e.id];
            if (view?.hidden) return null;
            const d = edgePath(graph, e);
            const color = portColor(e.kind);
            const drawn = view?.drawn ?? 1;
            return (
              <g key={e.id}>
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={view?.lit ? 3 : 2}
                  strokeLinecap="round"
                  strokeDasharray={e.kind === "control" ? "4 4" : undefined}
                  opacity={view?.dim ? 0.16 : drawn < 1 ? 0 : view?.lit ? 1 : 0.4}
                  style={{
                    filter: view?.lit ? `drop-shadow(0 0 6px ${color})` : undefined,
                    transition: "opacity 200ms, stroke-width 200ms, filter 200ms",
                  }}
                />
                {drawn < 1 && (
                  <motion.path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    style={{ pathLength: drawn, opacity: 0.85 }}
                  />
                )}
                {pulse && drawn >= 1 && (
                  <motion.path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeDasharray="5 190"
                    initial={{ strokeDashoffset: 195 }}
                    animate={{ strokeDashoffset: 0 }}
                    transition={{ duration: 3.6, repeat: Infinity, ease: "linear", delay: hashUnit(e.id) * 3 }}
                    style={{ filter: `drop-shadow(0 0 5px ${color})` }}
                  />
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {graph.nodes.map((n) => (
        <div key={n.id} style={{ position: "absolute", left: n.pos.x - b.minX, top: n.pos.y - b.minY, ...nodeStyle?.(n.id) }}>
          <MiniNodeBody spec={n} {...(runtime?.[n.id] ?? {})} />
        </div>
      ))}
    </div>
  );
}
