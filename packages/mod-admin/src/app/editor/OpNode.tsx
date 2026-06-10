import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { MessageSquare, Settings2 } from "lucide-react";
import type { PortInfo } from "@pattern/admin-sdk";
import { CONTROL_IN, CONTROL_OUT, type OpNodeData } from "./graph";
import { portFill, portTypeLabel } from "../lib/format";
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

/** Rich hover card for one port: name, kind<type>, required, description. */
function portTip(p: PortInfo, extra?: string) {
  return tip(
    <div className="space-y-0.5">
      <div className="font-mono text-[11px]">
        <span style={{ color: portFill(p) }}>●</span> {p.name}{" "}
        <span className="opacity-70">{portTypeLabel(p)}</span>
        {p.required && <span className="text-[var(--color-neon-amber)]"> · required</span>}
        {extra && <span className="opacity-70"> · {extra}</span>}
      </div>
      {p.description && <div className="text-muted">{p.description}</div>}
    </div>,
  );
}

const dotStyle = (p: PortInfo, side: "left" | "right", square = false): React.CSSProperties => ({
  position: "relative",
  [side]: -2,
  transform: "none",
  width: 10,
  height: 10,
  background: portFill(p),
  border: p.required ? "1.5px solid rgba(255,255,255,0.85)" : "none",
  borderRadius: square ? 2 : "50%",
});

/** A workflow node rendered from its op's ports (mod-admin-spec §12). Shows a
 *  friendly name + category icon/accent; ports are colored by *data type* (hover
 *  for the full type), config-input ports render as squares, and the implicit
 *  control run ports sit top (in) / bottom (out) for value-less chaining. */
export function OpNode({ data, selected }: NodeProps<Node<OpNodeData>>) {
  const cat = categoryStyle(categoryOfType(data.op));
  const accent = data.boundary ? "var(--color-neon-cyan)" : cat.color;
  const name = data.title ?? humanizeOp(data.op);
  const leftPorts = [...data.configInputs, ...data.inputs];
  const rightRows = data.outputs.length + data.controlOuts.length;
  const rows = Math.max(leftPorts.length, rightRows, 1);
  const height = HEADER + rows * HANDLE_GAP + 12;
  const { Icon } = cat;
  const replay = data.replay ? REPLAY[data.replay] : undefined;

  // The implicit control ports — shadowed by any declared port of the same name
  // (stream ops legitimately call their data ports `in`/`out`). Triggers have no
  // control-in: nothing can run before the outside world fires them.
  const hasControlIn = data.boundary !== "trigger" && !data.inputs.some((p) => p.name === CONTROL_IN);
  const hasControlOut = !data.outputs.some((p) => p.name === CONTROL_OUT);
  const controlSpec: PortInfo = { name: CONTROL_IN, kind: "control" };

  const borderColor = replay ? replay.color : selected ? "var(--color-neon-cyan)" : accent;

  /** The run tabs grow out of the node frame: same surface, same border, a
   *  control-grey dot in the middle — a notch, not a floating pill. */
  const runTab = (side: "top" | "bottom"): React.CSSProperties => ({
    width: 26,
    height: 10,
    [side]: -10,
    borderRadius: side === "top" ? "7px 7px 0 0" : "0 0 7px 7px",
    background: "var(--node-surface)",
    border: `1px solid ${borderColor}`,
    [side === "top" ? "borderBottom" : "borderTop"]: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });
  const runDot = <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--color-port-control)", pointerEvents: "none" }} />;

  return (
    <div
      className={`node-surface overflow-visible rounded-xl border ${replay?.pulse ? "animate-pulse" : ""}`}
      style={{
        width: 196,
        minHeight: height,
        borderColor,
        borderWidth: replay || selected ? 2 : 1,
        opacity: replay?.dim ? 0.45 : 1,
        boxShadow: replay && !replay.dim ? `0 0 18px ${replay.color}55` : undefined,
      }}
    >
      {/* run-after: the implicit control-in (§2) — chain ops without data */}
      {hasControlIn && (
        <Handle
          type="target"
          position={Position.Top}
          id={CONTROL_IN}
          {...portTip({ name: "in", kind: "control", description: "Run after — a dataless control pulse. Wire any node's run-then port here to sequence without passing a value." })}
          style={runTab("top")}
        >
          {runDot}
        </Handle>
      )}

      <div
        className="flex items-center gap-2 rounded-t-xl border-b hairline px-3 py-2"
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

      {/* config inputs (registration-time, square dots), then run inputs */}
      {data.configInputs.map((p, i) => (
        <div key={`cfg-${p.name}`} className="absolute left-2.5 flex items-center gap-1.5 text-[10px]" style={{ top: HEADER + 8 + i * HANDLE_GAP }} {...portTip(p, "config — resolved once at registration")}>
          <Handle type="target" position={Position.Left} id={p.name} style={dotStyle(p, "left", true)} />
          <Settings2 size={9} className="text-muted shrink-0" />
          <span className="text-muted font-mono">{p.name}</span>
        </div>
      ))}
      {data.inputs.map((p, i) => (
        <div key={`in-${p.name}`} className="absolute left-2.5 flex items-center gap-1.5 text-[10px]" style={{ top: HEADER + 8 + (data.configInputs.length + i) * HANDLE_GAP }} {...portTip(p)}>
          <Handle type="target" position={Position.Left} id={p.name} style={dotStyle(p, "left")} />
          <span className="text-muted font-mono">{p.name}</span>
        </div>
      ))}

      {/* outputs, then declared control-outs (branch/switch paths) */}
      {data.outputs.map((p, i) => (
        <div key={`out-${p.name}`} className="absolute right-2.5 flex items-center gap-1.5 text-[10px]" style={{ top: HEADER + 8 + i * HANDLE_GAP }} {...portTip(p)}>
          <span className="text-muted font-mono">{p.name}</span>
          <Handle type="source" position={Position.Right} id={p.name} style={dotStyle(p, "right")} />
        </div>
      ))}
      {data.controlOuts.map((co, i) => {
        const p: PortInfo = { name: co, kind: "control", description: "Control path — pulses when this branch is taken." };
        return (
          <div key={`co-${co}`} className="absolute right-2.5 flex items-center gap-1.5 text-[10px]" style={{ top: HEADER + 8 + (data.outputs.length + i) * HANDLE_GAP }} {...portTip(p)}>
            <span className="text-muted font-mono italic">{co}</span>
            <Handle type="source" position={Position.Right} id={co} style={{ ...dotStyle(p, "right"), borderRadius: 3, border: "1px dashed rgba(255,255,255,0.5)" }} />
          </div>
        );
      })}

      {/* run-then: the implicit control-out (§2) — pulses on completion */}
      {hasControlOut && (
        <Handle
          type="source"
          position={Position.Bottom}
          id={CONTROL_OUT}
          {...portTip({ ...controlSpec, name: "out", description: "Run then — pulses when this node completes. Wire into another node's run-after port to sequence without passing a value." })}
          style={runTab("bottom")}
        >
          {runDot}
        </Handle>
      )}
    </div>
  );
}
