/**
 * A FRAME — a named, commented, resizable box drawn UNDER op nodes (§T3).
 * Pure annotation: it ships in the workflow doc (`frames`), the engine never
 * reads it, the version hash ignores it. Dragging a frame carries the nodes
 * inside it (EditorPage owns that — the frame itself is just a node at
 * zIndex −10). Label edits inline; comment + tint appear when selected.
 */

import React from "react";
import { NodeResizer, useReactFlow, type Node as RFNode, type NodeProps } from "@xyflow/react";
import type { OpNodeData } from "./graph";

/** Preset tints — hues from the neon palette (0 = neutral glass). */
const HUES: Array<number | undefined> = [undefined, 190, 270, 330, 90, 40];

export function FrameNode({ id, data, selected }: NodeProps<RFNode<OpNodeData>>) {
  const rf = useReactFlow();
  const frame = data.frame ?? {};
  const hue = frame.hue;

  const tint = hue !== undefined ? `hsla(${hue}, 85%, 60%, 0.06)` : "color-mix(in srgb, var(--fg) 2.5%, transparent)";
  const edge = hue !== undefined ? `hsla(${hue}, 85%, 60%, 0.45)` : "var(--hairline)";
  const labelColor = hue !== undefined ? `hsla(${hue}, 85%, 65%, 0.95)` : "var(--fg-muted)";

  const update = (patch: Partial<NonNullable<OpNodeData["frame"]>>) =>
    rf.updateNodeData(id, { frame: { ...frame, ...patch } });

  return (
    <div
      className="h-full w-full rounded-2xl"
      style={{ background: tint, border: `1.5px dashed ${edge}`, minWidth: 140, minHeight: 90 }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={90}
        lineStyle={{ borderColor: edge }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, background: edge, border: "none" }}
      />
      <div className="flex flex-col gap-1 px-3 pt-2">
        <input
          value={frame.label ?? ""}
          placeholder="Frame"
          onChange={(e) => update({ label: e.target.value })}
          className="nodrag w-full bg-transparent text-[12px] font-semibold uppercase tracking-wider outline-none"
          style={{ color: labelColor }}
          aria-label="Frame label"
        />
        {selected ? (
          <>
            <textarea
              value={frame.comment ?? ""}
              placeholder="comment…"
              rows={2}
              onChange={(e) => update({ comment: e.target.value })}
              className="nodrag w-full resize-none bg-transparent text-[11px] leading-relaxed outline-none"
              style={{ color: "var(--fg-muted)" }}
              aria-label="Frame comment"
            />
            <div className="nodrag flex items-center gap-1.5 pb-1.5">
              {HUES.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => update({ hue: h })}
                  aria-label={h === undefined ? "Neutral tint" : `Tint hue ${h}`}
                  className="h-3.5 w-3.5 rounded-full transition-transform hover:scale-125"
                  style={{
                    background: h === undefined ? "var(--fg-muted)" : `hsl(${h}, 85%, 60%)`,
                    outline: hue === h ? "2px solid var(--fg)" : "1px solid var(--hairline)",
                    outlineOffset: 1,
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          frame.comment && (
            <div className="max-w-[40ch] truncate text-[11px]" style={{ color: "var(--fg-muted)" }}>
              {frame.comment}
            </div>
          )
        )}
      </div>
    </div>
  );
}
