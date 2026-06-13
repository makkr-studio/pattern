/**
 * A PORTAL-rendered edge — the named-reroute answer to wires that cross the
 * whole canvas. The EDGE STAYS IN THE DOC (dataflow truth: scheduling, types,
 * skip propagation, diffs all see a normal edge); only the VIEW changes — the
 * wire is replaced by two paired glyphs: `name ▸` at the source port and
 * `▸ name` at the target port. Double-click an edge to toggle (EditorPage);
 * select a glyph to rename. Hovering either glyph ghosts the real wire in so
 * you never lose track of what connects to what.
 */

import React, { useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from "@xyflow/react";

function chipColor(kind: string | undefined): string {
  return kind === "stream"
    ? "var(--color-port-stream)"
    : kind === "control"
      ? "var(--color-port-control)"
      : "var(--color-port-value)";
}

export function PortalEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props;
  const rf = useReactFlow();
  const [hover, setHover] = useState(false);

  const name = (data?.portal as string) || "portal";
  const kind = data?.kind as string | undefined;
  const color = chipColor(kind);

  const rename = (value: string) =>
    rf.setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { ...e.data, portal: value || "portal" } } : e)));

  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  const chip = (x: number, y: number, side: "out" | "in") => (
    <div
      className="nodrag nopan tip-surface pointer-events-auto absolute flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px]"
      style={{
        transform: `translate(${side === "out" ? "4px" : "calc(-100% - 4px)"}, -50%) translate(${x}px, ${y}px)`,
        color,
        boxShadow: `0 0 0 1px ${color}40, 0 4px 14px rgba(0,0,0,0.25)`,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`portal "${name}" — double-click the glyph to restore the wire`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        rf.setEdges((es) =>
          es.map((edge) => (edge.id === id ? { ...edge, type: "default", data: { ...edge.data, portal: undefined } } : edge)),
        );
      }}
    >
      {side === "in" && <span aria-hidden>▸</span>}
      {selected && side === "out" ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => rename(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="w-[8ch] bg-transparent outline-none"
          style={{ color }}
          aria-label="Portal name"
        />
      ) : (
        <span>{name}</span>
      )}
      {side === "out" && <span aria-hidden>▸</span>}
    </div>
  );

  return (
    <>
      {/* The ghost wire: visible while hovering a glyph (or selected) so the
          connection is never a mystery — otherwise fully hidden. */}
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: 1.5,
          strokeDasharray: "3 5",
          opacity: hover || selected ? 0.5 : 0,
          transition: "opacity 150ms",
          pointerEvents: "none",
        }}
      />
      <EdgeLabelRenderer>
        {chip(sourceX, sourceY, "out")}
        {chip(targetX, targetY, "in")}
      </EdgeLabelRenderer>
    </>
  );
}
