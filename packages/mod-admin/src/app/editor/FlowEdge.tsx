/**
 * The default wire — a fluid bezier identical to xyflow's default edge, plus
 * one behaviour: when either of its ports is hovered (see editor/hover) it
 * brightens, thickens and casts a soft glow in its own color, so hovering a
 * port traces every connection leaving (or entering) it. Stream `animated`
 * dashes and the control-edge dash pattern ride through untouched — they live
 * on the edge wrapper class / `style`, which we pass straight to BaseEdge.
 */

import React from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { useEdgeActive } from "./hover";

export function FlowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, source, target, sourceHandleId, targetHandleId, style } = props;
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const active = useEdgeActive(source, sourceHandleId, target, targetHandleId);
  const base = (style ?? {}) as React.CSSProperties;
  const stroke = base.stroke as string | undefined;
  return (
    <BaseEdge
      id={id}
      path={path}
      style={{
        ...base,
        strokeWidth: active ? 3 : (base.strokeWidth ?? 2),
        opacity: active ? 1 : (base.opacity ?? 0.9),
        filter: active && stroke ? `drop-shadow(0 0 5px ${stroke})` : base.filter,
        transition: "stroke-width 140ms, filter 140ms, opacity 140ms",
      }}
    />
  );
}
