import { type CSSProperties } from "react";
import { MiniNodeBody } from "./MiniOpNode";
import { edgePath, graphBounds } from "./geometry";
import { portColor } from "./format";
import type { MiniGraph, MiniNodeRuntime } from "./types";

/** Per-edge presentation override (run glow / dimming). */
export interface EdgeView {
  lit?: boolean;
  dim?: boolean;
  hidden?: boolean;
}

/**
 * Renders a MiniGraph as a plain layer: absolutely-positioned MiniNodeBody nodes
 * over an SVG of glowing bezier wires. No xyflow, no motion — a STATIC render that
 * matches the site/admin canvas at rest. Per-node and per-edge state is external.
 */
export function StaticGraph({
  graph,
  runtime,
  edges,
  nodeStyle,
  className,
  style,
}: {
  graph: MiniGraph;
  runtime?: Record<string, MiniNodeRuntime>;
  edges?: Record<string, EdgeView>;
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
            return (
              <path
                key={e.id}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={view?.lit ? 3 : 2}
                strokeLinecap="round"
                strokeDasharray={e.kind === "control" ? "4 4" : undefined}
                opacity={view?.dim ? 0.16 : view?.lit ? 1 : 0.55}
                style={{
                  // A soft glow so the wires read "lit", like the site/admin canvas.
                  filter: view?.lit
                    ? `drop-shadow(0 0 6px ${color})`
                    : `drop-shadow(0 0 4px color-mix(in srgb, ${color} 55%, transparent))`,
                }}
              />
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
