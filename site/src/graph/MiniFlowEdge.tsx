import { type CSSProperties } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { portColor, type PortKind } from "../lib/format";

/** Per-kind edge styling — value cyan, stream violet, control grey/dashed. */
export function edgeStyle(kind: PortKind): CSSProperties {
  return { stroke: portColor(kind), strokeWidth: 2, strokeDasharray: kind === "control" ? "4 4" : undefined };
}

/**
 * The editor's wire — a fluid bezier (xyflow default), plus a `lit` flag the
 * fake-run engine sets so an edge brightens + glows as data flows through it,
 * and a `dim` flag for not-yet-executed edges. Stream `animated` dashes ride
 * through via the edge's `animated` prop (set in miniFlow).
 */
export function MiniFlowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data } = props;
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const base = (style ?? {}) as CSSProperties;
  const stroke = base.stroke as string | undefined;
  const lit = Boolean(data?.lit);
  const dim = Boolean(data?.dim);
  return (
    <BaseEdge
      id={id}
      path={path}
      style={{
        ...base,
        strokeWidth: lit ? 3 : (base.strokeWidth ?? 2),
        opacity: dim ? 0.25 : lit ? 1 : (base.opacity ?? 0.9),
        filter: lit && stroke ? `drop-shadow(0 0 6px ${stroke})` : base.filter,
        transition: "stroke-width 160ms, filter 160ms, opacity 160ms",
      }}
    />
  );
}
