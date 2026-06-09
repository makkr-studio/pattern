import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { OpNodeData } from "./graph";
import { portColor } from "../lib/format";
import { categoryOfType, categoryStyle, humanizeOp } from "../lib/categories";

const HANDLE_GAP = 22;
const HEADER = 40;

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

  return (
    <div
      className="glass-strong overflow-hidden rounded-xl"
      style={{ width: 196, minHeight: height, borderColor: selected ? "var(--color-neon-cyan)" : accent, borderWidth: selected ? 2 : 1 }}
    >
      <div className="flex items-center gap-2 border-b hairline px-3 py-2" style={{ background: cat.soft }}>
        <Icon size={14} style={{ color: cat.color }} />
        <span className="truncate text-sm font-medium">{name}</span>
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
