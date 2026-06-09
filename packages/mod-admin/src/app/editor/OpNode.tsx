import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { OpNodeData } from "./graph";
import { portColor } from "../lib/format";

const HANDLE_GAP = 22;
const HEADER = 44;

/** A workflow node rendered from its op's ports (mod-admin-spec §12). Value
 *  handles are cyan, stream violet, control grey — consistent with edges. */
export function OpNode({ data, selected }: NodeProps<Node<OpNodeData>>) {
  const accent = data.boundary === "trigger" ? "var(--color-neon-cyan)" : data.boundary === "outgate" ? "var(--color-neon-violet)" : "var(--glass-border)";
  const rows = Math.max(data.inputs.length, data.outputs.length, 1);
  const height = HEADER + rows * HANDLE_GAP + 10;
  return (
    <div
      className="glass-strong rounded-xl"
      style={{ width: 200, minHeight: height, borderColor: selected ? "var(--color-neon-cyan)" : accent, borderWidth: selected ? 2 : 1 }}
    >
      <div className="truncate border-b hairline px-3 py-2">
        <div className="truncate text-sm font-medium">{data.title ?? data.op.split(".").slice(-1)[0]}</div>
        <div className="text-muted truncate font-mono text-[10px]">{data.op}</div>
      </div>

      {/* Input handles (left) */}
      {data.inputs.map((p, i) => (
        <div key={`in-${p.name}`} className="absolute left-2 flex items-center gap-1 text-[10px]" style={{ top: HEADER + i * HANDLE_GAP }}>
          <Handle
            type="target"
            position={Position.Left}
            id={p.name}
            style={{ position: "relative", left: 0, transform: "none", width: 9, height: 9, background: portColor(p.kind), border: "none" }}
          />
          <span className="text-muted font-mono">{p.name}</span>
        </div>
      ))}

      {/* Output handles (right) */}
      {data.outputs.map((p, i) => (
        <div key={`out-${p.name}`} className="absolute right-2 flex items-center gap-1 text-[10px]" style={{ top: HEADER + i * HANDLE_GAP }}>
          <span className="text-muted font-mono">{p.name}</span>
          <Handle
            type="source"
            position={Position.Right}
            id={p.name}
            style={{ position: "relative", right: 0, transform: "none", width: 9, height: 9, background: portColor(p.kind), border: "none" }}
          />
        </div>
      ))}
    </div>
  );
}
