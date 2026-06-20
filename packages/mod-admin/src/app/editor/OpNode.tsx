import { useEffect } from "react";
import { Handle, Position, useNodeConnections, useUpdateNodeInternals, type NodeProps, type Node } from "@xyflow/react";
import { MessageSquare, Settings2 } from "lucide-react";
import type { PortInfo } from "@pattern-js/admin-sdk";
import { CONTROL_IN, CONTROL_OUT, type OpNodeData } from "./graph";
import { usePortHandlers } from "./hover";
import { portFill, portTypeLabel } from "../lib/format";
import { categoryOfType, categoryStyle, humanizeOp } from "../lib/categories";
import { tip } from "../components/Tooltip";
import { Markdown } from "../components/Markdown";

const HANDLE_GAP = 22;
const HEADER = 40;
const W = 196;
/** Run-tab notch geometry — the notch is carved into the frame path itself. */
const TAB_W = 26;
const TAB_H = 10;
const TAB_R = 6;
const RADIUS = 12; // rounded-xl

/**
 * The node outline as ONE SVG path: a rounded rect with the run-tab notches
 * built into the frame (a bump up at top-center for control-in, down at
 * bottom-center for control-out). One continuous stroke means the notch IS
 * the border — no seam where a separate pill would touch the node.
 */
function framePath(w: number, h: number, topTab: boolean, bottomTab: boolean): string {
  const cx = w / 2;
  const lift = TAB_H - TAB_R;
  const flat = TAB_W - 2 * TAB_R;
  const r = RADIUS;
  let d = `M ${r} 0`;
  if (topTab) {
    d += ` H ${cx - TAB_W / 2} v ${-lift} a ${TAB_R} ${TAB_R} 0 0 1 ${TAB_R} ${-TAB_R} h ${flat} a ${TAB_R} ${TAB_R} 0 0 1 ${TAB_R} ${TAB_R} v ${lift}`;
  }
  d += ` H ${w - r} a ${r} ${r} 0 0 1 ${r} ${r} V ${h - r} a ${r} ${r} 0 0 1 ${-r} ${r}`;
  if (bottomTab) {
    d += ` H ${cx + TAB_W / 2} v ${lift} a ${TAB_R} ${TAB_R} 0 0 1 ${-TAB_R} ${TAB_R} h ${-flat} a ${TAB_R} ${TAB_R} 0 0 1 ${-TAB_R} ${-TAB_R} v ${-lift}`;
  }
  d += ` H ${r} a ${r} ${r} 0 0 1 ${-r} ${-r} V ${r} a ${r} ${r} 0 0 1 ${r} ${-r} Z`;
  return d;
}

/** Replay-state visual treatment (admin internals §15.1). */
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

/** A required input's marker: loud amber while the port is unwired ("this
 *  still needs a wire"), calm once satisfied. */
const RequiredMark = ({ satisfied }: { satisfied: boolean }) => (
  <span
    aria-label={satisfied ? "required (wired)" : "required (unwired)"}
    className={`-ml-1 font-semibold ${satisfied ? "text-muted" : "text-[var(--color-neon-amber)]"}`}
  >
    *
  </span>
);

const dotStyle = (p: PortInfo, side: "left" | "right", square = false, wired?: boolean, active = false): React.CSSProperties => ({
  position: "relative",
  [side]: -2,
  transform: "none",
  width: 10,
  height: 10,
  background: portFill(p),
  // Required inputs ring their dot — AMBER + glow while unwired, quiet white
  // once a wire satisfies them.
  border: p.required ? (wired ? "1.5px solid rgba(255,255,255,0.85)" : "1.5px solid var(--color-neon-amber)") : "none",
  // Hover-highlight wins: a port lit because it (or its far end) is hovered
  // glows in its own color; otherwise the required-unwired amber glow stands.
  boxShadow: active
    ? `0 0 0 3px ${portFill(p)}55, 0 0 10px 2px ${portFill(p)}`
    : p.required && !wired
      ? "0 0 7px var(--color-neon-amber)"
      : undefined,
  borderRadius: square ? 2 : "50%",
  transition: "box-shadow 140ms",
  zIndex: active ? 5 : undefined,
});

/** One input-port row — a component so it can watch its own connections:
 *  required ports flip from amber (unwired) to calm the moment a wire lands,
 *  and the dot lights when this port (or the far end of one of its wires) is
 *  hovered. */
function InputRow({ nodeId, p, top, config }: { nodeId: string; p: PortInfo; top: number; config?: boolean }) {
  const connections = useNodeConnections({ handleType: "target", handleId: p.name });
  const wired = connections.length > 0;
  const { active, onMouseEnter, onMouseLeave } = usePortHandlers({ node: nodeId, port: p.name, end: "target" });
  return (
    <div className="absolute left-2.5 flex items-center gap-1.5 text-[10px]" style={{ top }} {...portTip(p, config ? "config — resolved once at registration" : undefined)}>
      <Handle type="target" position={Position.Left} id={p.name} style={dotStyle(p, "left", config, wired, active)} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
      {config && <Settings2 size={9} className="text-muted shrink-0" />}
      <span className="text-muted font-mono">{p.name}</span>
      {p.required && <RequiredMark satisfied={wired} />}
    </div>
  );
}

/** One output-port row (value output or declared control-out). A component so
 *  each dot can light when its port — or the far end of a wire from it — is
 *  hovered. */
function OutputRow({ nodeId, p, top, control = false }: { nodeId: string; p: PortInfo; top: number; control?: boolean }) {
  const { active, onMouseEnter, onMouseLeave } = usePortHandlers({ node: nodeId, port: p.name, end: "source" });
  return (
    <div className="absolute right-2.5 flex items-center gap-1.5 text-[10px]" style={{ top }} {...portTip(p)}>
      <span className={`text-muted font-mono ${control ? "italic" : ""}`}>{p.name}</span>
      <Handle
        type="source"
        position={Position.Right}
        id={p.name}
        style={control ? { ...dotStyle(p, "right", false, undefined, active), borderRadius: 3, border: "1px dashed rgba(255,255,255,0.5)" } : dotStyle(p, "right", false, undefined, active)}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    </div>
  );
}

/** A workflow node rendered from its op's ports (admin internals §12). Shows a
 *  friendly name + category icon/accent; ports are colored by *data type* (hover
 *  for the full type), config-input ports render as squares, and the implicit
 *  control run ports sit top (in) / bottom (out) for value-less chaining. */
export function OpNode({ id, data, selected }: NodeProps<Node<OpNodeData>>) {
  // Dynamic ports: when config edits add/remove handles, xyflow must re-measure
  // them or new handles stay unconnectable (cached node internals).
  const updateInternals = useUpdateNodeInternals();
  const handleSig = [...data.configInputs, ...data.inputs, ...data.outputs].map((p) => p.name).join(",") + "|" + data.controlOuts.join(",");
  useEffect(() => updateInternals(id), [id, handleSig, updateInternals]);

  const cat = categoryStyle(categoryOfType(data.op));
  const accent = data.boundary ? "var(--color-neon-cyan)" : cat.color;
  const name = data.title ?? humanizeOp(data.op);
  const leftPorts = [...data.configInputs, ...data.inputs];
  const rightRows = data.outputs.length + data.controlOuts.length;
  const rows = Math.max(leftPorts.length, rightRows, 1);
  const height = HEADER + rows * HANDLE_GAP + 12;
  const { Icon } = cat;
  const replay = data.replay ? REPLAY[data.replay] : undefined;

  // Run-port (implicit control) hover wiring — computed unconditionally so the
  // hooks run even when a tab is shadowed/absent (rules of hooks).
  const ctrlIn = usePortHandlers({ node: id, port: CONTROL_IN, end: "target" });
  const ctrlOut = usePortHandlers({ node: id, port: CONTROL_OUT, end: "source" });

  // The implicit control ports — shadowed by any declared port of the same name
  // (stream ops legitimately call their data ports `in`/`out`). Triggers have no
  // control-in: nothing can run before the outside world fires them.
  const hasControlIn = data.boundary !== "trigger" && !data.inputs.some((p) => p.name === CONTROL_IN);
  const hasControlOut = !data.outputs.some((p) => p.name === CONTROL_OUT);
  const controlSpec: PortInfo = { name: CONTROL_IN, kind: "control" };

  // Selection emphasizes the node's OWN accent (brighter, with a light glow) —
  // not a one-color-fits-all highlight. Replay states still take precedence.
  const emphasized = `color-mix(in srgb, ${accent} 55%, white)`;
  const borderColor = replay ? replay.color : selected ? emphasized : accent;
  const borderWidth = replay || selected ? 2 : 1;

  /** The run-tab handles are invisible HIT AREAS over the notch bumps (the
   *  visual notch is part of the frame: SVG outline + a fill continuing the
   *  surface it grows out of). Position pinned explicitly — xyflow's default
   *  handle transform would float them off the frame. */
  const runTab = (side: "top" | "bottom"): React.CSSProperties => ({
    width: TAB_W,
    height: TAB_H + 2,
    [side]: -TAB_H,
    left: "50%",
    transform: "translateX(-50%)",
    background: "transparent",
    border: "none",
    borderRadius: side === "top" ? `${TAB_R}px ${TAB_R}px 0 0` : `0 0 ${TAB_R}px ${TAB_R}px`,
    display: "flex",
    alignItems: side === "top" ? "flex-start" : "flex-end",
    justifyContent: "center",
    zIndex: 2,
  });
  const runDot = (side: "top" | "bottom", active = false) => (
    <span
      style={
        {
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: "var(--color-port-control)",
          pointerEvents: "none",
          boxShadow: active ? "0 0 8px 2px var(--color-port-control)" : undefined,
          transition: "box-shadow 140ms",
          [side === "top" ? "marginTop" : "marginBottom"]: 3,
        } as React.CSSProperties
      }
    />
  );
  /** The notch interior: continues the exact paint stack of the surface it
   *  grows out of — header tint over node surface at the top, plain node
   *  surface at the bottom — so the notch reads as part of the node. */
  const notchFill = (side: "top" | "bottom"): React.CSSProperties => ({
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    width: TAB_W - 2,
    height: TAB_H,
    [side]: -TAB_H,
    borderRadius: side === "top" ? `${TAB_R}px ${TAB_R}px 0 0` : `0 0 ${TAB_R}px ${TAB_R}px`,
    background: side === "top" ? `linear-gradient(${cat.soft}, ${cat.soft}), var(--node-surface)` : "var(--node-surface)",
    backdropFilter: "var(--node-blur)",
    pointerEvents: "none",
  });

  return (
    <div
      className={`node-surface overflow-visible rounded-xl ${replay?.pulse ? "animate-pulse" : ""}`}
      style={{
        width: W,
        minHeight: height,
        opacity: replay?.dim ? 0.45 : 1,
        boxShadow:
          replay && !replay.dim
            ? `0 0 18px ${replay.color}55`
            : selected
              ? `var(--glass-shadow), 0 0 16px color-mix(in srgb, ${accent} 45%, transparent)`
              : undefined,
      }}
    >
      {/* notch interiors — painted first, under everything */}
      {hasControlIn && <div style={notchFill("top")} />}
      {hasControlOut && <div style={notchFill("bottom")} />}

      {/* run-after: the implicit control-in (§2) — chain ops without data */}
      {hasControlIn && (
        <Handle
          type="target"
          position={Position.Top}
          id={CONTROL_IN}
          {...portTip({ name: "in", kind: "control", description: "Run after — a dataless control pulse. Wire any node's run-then port here to sequence without passing a value." })}
          style={runTab("top")}
          onMouseEnter={ctrlIn.onMouseEnter}
          onMouseLeave={ctrlIn.onMouseLeave}
        >
          {runDot("top", ctrlIn.active)}
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
        <InputRow key={`cfg-${p.name}`} nodeId={id} p={p} top={HEADER + 8 + i * HANDLE_GAP} config />
      ))}
      {data.inputs.map((p, i) => (
        <InputRow key={`in-${p.name}`} nodeId={id} p={p} top={HEADER + 8 + (data.configInputs.length + i) * HANDLE_GAP} />
      ))}

      {/* outputs, then declared control-outs (branch/switch paths) */}
      {data.outputs.map((p, i) => (
        <OutputRow key={`out-${p.name}`} nodeId={id} p={p} top={HEADER + 8 + i * HANDLE_GAP} />
      ))}
      {data.controlOuts.map((co, i) => (
        <OutputRow
          key={`co-${co}`}
          nodeId={id}
          p={{ name: co, kind: "control", description: "Control path — pulses when this branch is taken." }}
          top={HEADER + 8 + (data.outputs.length + i) * HANDLE_GAP}
          control
        />
      ))}

      {/* run-then: the implicit control-out (§2) — pulses on completion */}
      {hasControlOut && (
        <Handle
          type="source"
          position={Position.Bottom}
          id={CONTROL_OUT}
          {...portTip({ ...controlSpec, name: "out", description: "Run then — pulses when this node completes. Wire into another node's run-after port to sequence without passing a value." })}
          style={runTab("bottom")}
          onMouseEnter={ctrlOut.onMouseEnter}
          onMouseLeave={ctrlOut.onMouseLeave}
        >
          {runDot("bottom", ctrlOut.active)}
        </Handle>
      )}

      {/* the frame: one continuous stroke, notches included */}
      <svg
        aria-hidden
        style={{ position: "absolute", left: 0, top: 0, width: W, height, overflow: "visible", pointerEvents: "none", zIndex: 1 }}
      >
        <path d={framePath(W, height, hasControlIn, hasControlOut)} fill="none" stroke={borderColor} strokeWidth={borderWidth} />
      </svg>
    </div>
  );
}
