import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { MessageSquare } from "lucide-react";
import type { OpNodeData } from "./graph";
import { portColor } from "../lib/format";
import { categoryOfType, categoryStyle, humanizeOp } from "../lib/categories";
import { tip } from "../components/Tooltip";
import { Markdown } from "../components/Markdown";

const HANDLE_GAP = 22;
const HEADER = 40;

/** Replay-state visual treatment (mod-admin-spec §15.1). */
const REPLAY: Record<string, { color: string; dim: boolean; pulse: boolean }> = {
  pending: { color: "var(--color-port-control)", dim: true, pulse: false },
  running: { color: "var(--color-neon-cyan)", dim: false, pulse: true },
  ok: { color: "var(--color-neon-lime)", dim: false, pulse: false },
  error: { color: "var(--color-neon-pink)", dim: false, pulse: false },
  skipped: { color: "var(--color-port-control)", dim: true, pulse: false },
};

/** A workflow node rendered from its op's ports (mod-admin-spec §12). Shows a
 *  friendly name + category icon/accent — the technical op type lives in the
 *  inspector. Handles are colored by kind (cyan value, violet stream, grey control). */
export function OpNode({ data, selected }: NodeProps<Node<OpNodeData>>) {
  const cat = categoryStyle(categoryOfType(data.op));
  const accent = data.boundary ? "var(--color-neon-cyan)" : cat.color;
  const name = data.title ?? humanizeOp(data.op);
  const rows = Math.max(data.inputs.length, data.outputs.length, 1);
  const height = HEADER + rows * HANDLE_GAP + 12;
  const { Icon } = cat;
  const replay = data.replay ? REPLAY[data.replay] : undefined;

  return (
    <div
      className={`glass-strong overflow-hidden rounded-xl ${replay?.pulse ? "animate-pulse" : ""}`}
      style={{
        width: 196,
        minHeight: height,
        borderColor: replay ? replay.color : selected ? "var(--color-neon-cyan)" : accent,
        borderWidth: replay || selected ? 2 : 1,
        opacity: replay?.dim ? 0.45 : 1,
        boxShadow: replay && !replay.dim ? `0 0 18px ${replay.color}55` : undefined,
      }}
    >
      <div
        className="flex items-center gap-2 border-b hairline px-3 py-2"
        style={{ background: cat.soft }}
        {...tip(data.description ? <Markdown text={data.description} /> : null)}
      >
        <Icon size={14} style={{ color: cat.color }} className="shrink-0" />
        <span className="truncate text-sm font-medium">{name}</span>
        {data.comment && (
          <span {...tip(<Markdown text={data.comment} />)} className="shrink-0 text-[var(--color-neon-amber)]">
            <MessageSquare size={12} />
          </span>
        )}
        {data.boundary && (
          <span className="ml-auto rounded px-1 py-0.5 text-[9px] uppercase tracking-wide" style={{ background: "var(--color-neon-cyan)", color: "#000" }}>
            {data.boundary === "trigger" ? "trig" : "out"}
          </span>
        )}
      </div>

      {data.inputs.map((p, i) => (
        <div key={`in-${p.name}`} className="absolute left-2.5 flex items-center gap-1.5 text-[10px]" style={{ top: HEADER + 8 + i * HANDLE_GAP }}>
          <Handle
            type="target"
            position={Position.Left}
            id={p.name}
            style={{ position: "relative", left: -2, transform: "none", width: 9, height: 9, background: portColor(p.kind), border: "none" }}
          />
          <span className="text-muted font-mono">{p.name}</span>
        </div>
      ))}

      {data.outputs.map((p, i) => (
        <div key={`out-${p.name}`} className="absolute right-2.5 flex items-center gap-1.5 text-[10px]" style={{ top: HEADER + 8 + i * HANDLE_GAP }}>
          <span className="text-muted font-mono">{p.name}</span>
          <Handle
            type="source"
            position={Position.Right}
            id={p.name}
            style={{ position: "relative", right: -2, transform: "none", width: 9, height: 9, background: portColor(p.kind), border: "none" }}
          />
        </div>
      ))}
    </div>
  );
}
