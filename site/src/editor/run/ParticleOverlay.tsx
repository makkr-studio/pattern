import { edgePath } from "../../graph/geometry";
import { portColor } from "../../lib/format";
import type { MiniGraph } from "../../graph/types";

const COUNT = 5;

/**
 * Tokens streaming along a stream edge. Uses SVG animateMotion along the exact
 * same bezier the wire is drawn with, so it stays perfectly aligned. Rendered
 * inside the canvas's already-translated <g>, so it adds no offset of its own.
 */
export function ParticleOverlay({ graph, edgeId }: { graph: MiniGraph; edgeId: string }) {
  const edge = graph.edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const d = edgePath(graph, edge);
  if (!d) return null;
  const color = portColor("stream");
  return (
    <g>
      {Array.from({ length: COUNT }, (_, i) => (
        <circle key={i} r={3.5} fill={color} style={{ filter: `drop-shadow(0 0 5px ${color})` }}>
          <animateMotion dur="1.1s" repeatCount="indefinite" begin={`${(i / COUNT) * 1.1}s`} path={d} />
          <animate attributeName="opacity" values="0;1;1;0" dur="1.1s" repeatCount="indefinite" begin={`${(i / COUNT) * 1.1}s`} />
        </circle>
      ))}
    </g>
  );
}
