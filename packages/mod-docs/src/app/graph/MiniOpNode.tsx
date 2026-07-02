import { type CSSProperties, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { categoryOfType, categoryStyle, humanizeOp } from "./categories";
import { portFill } from "./format";
import type { MiniNodeRuntime, MiniNodeSpec, MiniPort, ReplayState } from "./types";

// Geometry — constant-for-constant with the admin's OpNode so a Mini node is a
// pixel-faithful twin of the real thing.
export const HANDLE_GAP = 22;
export const HEADER = 40;
export const NODE_W = 196;
const TAB_W = 26;
const TAB_H = 10;
const TAB_R = 6;
const RADIUS = 12;

/** Rendered height of a node (mirrors OpNode's geometry). */
export function miniNodeHeight(spec: MiniNodeSpec): number {
  const left = (spec.configInputs?.length ?? 0) + spec.inputs.length;
  const right = spec.outputs.length + (spec.controlOuts?.length ?? 0);
  const rows = Math.max(left, right, 1);
  return HEADER + rows * HANDLE_GAP + 12;
}

// The port dots are inset from the node's left/right edge (the dot sits ~13px
// in). Anchors point at the dot center so wires connect to the dots and the
// editor's hit targets line up with what you actually see and grab.
const DOT_INSET = 13;

/** The (x,y) anchor of a port (its dot center) relative to the node origin. */
export function portAnchor(spec: MiniNodeSpec, port: string, dir: "in" | "out"): { x: number; y: number } {
  if (dir === "in") {
    const left = [...(spec.configInputs ?? []), ...spec.inputs];
    const i = Math.max(0, left.findIndex((p) => p.name === port));
    return { x: DOT_INSET, y: HEADER + 8 + i * HANDLE_GAP + 6 };
  }
  const right = [...spec.outputs.map((p) => p.name), ...(spec.controlOuts ?? [])];
  const i = Math.max(0, right.indexOf(port));
  return { x: NODE_W - DOT_INSET, y: HEADER + 8 + i * HANDLE_GAP + 6 };
}

/** The node outline as ONE SVG path with run-tab notches built into the frame. */
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

const REPLAY: Record<Exclude<ReplayState, "idle">, { color: string; dim: boolean; pulse: boolean }> = {
  pending: { color: "var(--color-port-control)", dim: true, pulse: false },
  running: { color: "var(--color-neon-cyan)", dim: false, pulse: true },
  ok: { color: "var(--color-neon-lime)", dim: false, pulse: false },
  error: { color: "var(--color-neon-pink)", dim: false, pulse: false },
};

function dotStyle(
  color: string,
  side: "left" | "right",
  opts: { square?: boolean; required?: boolean; wired?: boolean; glow?: boolean } = {},
): CSSProperties {
  const { square, required, wired, glow } = opts;
  return {
    position: "relative",
    [side]: -2,
    width: 10,
    height: 10,
    background: color,
    border: required ? (wired ? "1.5px solid rgba(255,255,255,0.85)" : "1.5px solid var(--color-neon-amber)") : "none",
    boxShadow: glow
      ? `0 0 0 3px color-mix(in srgb, ${color} 35%, transparent), 0 0 10px 2px ${color}`
      : required && !wired
        ? "0 0 7px var(--color-neon-amber)"
        : undefined,
    borderRadius: square ? 2 : "50%",
    transition: "box-shadow 140ms",
    zIndex: glow ? 5 : undefined,
  };
}

export interface DotArgs {
  port: MiniPort;
  side: "left" | "right";
  color: string;
  square?: boolean;
  required?: boolean;
  wired?: boolean;
  glow?: boolean;
}

/** How a port's dot is rendered. Default = a plain span; the editor injects an
 *  xyflow <Handle> styled identically so the node works inside a canvas too. */
export type DotRenderer = (args: DotArgs) => ReactNode;

const defaultDot: DotRenderer = ({ color, side, square, required, wired, glow }) => (
  <span style={dotStyle(color, side, { square, required, wired, glow })} />
);

export interface MiniNodeBodyProps extends MiniNodeRuntime {
  spec: MiniNodeSpec;
  /** Inject xyflow Handles in the editor; omit for the static SVG layer. */
  renderDot?: DotRenderer;
}

/**
 * A workflow node rendered from its op's ports, a slimmed twin of the admin's
 * OpNode: glass surface + SVG frame with control notches, header with the op's
 * category tint + icon, port dots colored by kind/type, and replay states
 * (pending→running→ok→error). No live data layer; everything comes from props.
 */
export function MiniNodeBody({ spec, replay, glow = [], wired = [], selected, renderDot = defaultDot }: MiniNodeBodyProps) {
  const cat = categoryStyle(categoryOfType(spec.op));
  const accent = spec.boundary ? "var(--color-neon-cyan)" : cat.color;
  const name = spec.title ?? humanizeOp(spec.op);
  const { Icon } = cat;

  const configInputs = spec.configInputs ?? [];
  const controlOuts = spec.controlOuts ?? [];
  const height = miniNodeHeight(spec);

  const rep = replay && replay !== "idle" ? REPLAY[replay] : undefined;
  const emphasized = `color-mix(in srgb, ${accent} 55%, white)`;
  const borderColor = rep ? rep.color : selected ? emphasized : accent;
  const borderWidth = rep || selected ? 2 : 1;

  const hasControlIn = spec.boundary !== "trigger" && !spec.inputs.some((p) => p.name === "in");
  const hasControlOut = !spec.outputs.some((p) => p.name === "out");

  const glowSet = new Set(glow);
  const wiredSet = new Set(wired);

  const notchFill = (side: "top" | "bottom"): CSSProperties => ({
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
  const runDot = (side: "top" | "bottom"): CSSProperties => ({
    position: "absolute",
    left: "50%",
    [side]: side === "top" ? -TAB_H + 3 : -TAB_H + 2,
    transform: "translateX(-50%)",
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "var(--color-port-control)",
    pointerEvents: "none",
  });

  return (
    <div
      className={`node-surface relative overflow-visible rounded-xl ${rep?.pulse ? "animate-pulse" : ""}`}
      style={{
        width: NODE_W,
        minHeight: height,
        opacity: rep?.dim ? 0.45 : 1,
        boxShadow:
          rep && !rep.dim
            ? `0 0 18px color-mix(in srgb, ${rep.color} 33%, transparent)`
            : selected
              ? `var(--glass-shadow), 0 0 16px color-mix(in srgb, ${accent} 45%, transparent)`
              : undefined,
      }}
    >
      {hasControlIn && <div style={notchFill("top")} />}
      {hasControlOut && <div style={notchFill("bottom")} />}
      {hasControlIn && <span style={runDot("top")} />}
      {hasControlOut && <span style={runDot("bottom")} />}

      <div className="flex items-center gap-2 rounded-t-xl border-b hairline px-3 py-2" style={{ background: cat.soft }}>
        <Icon size={14} style={{ color: cat.color }} className="shrink-0" />
        <span className="truncate text-sm font-medium">{name}</span>
        {spec.boundary && (
          <span
            className="ml-auto rounded px-1 py-0.5 text-[9px] uppercase tracking-wide"
            style={{ background: "var(--color-neon-cyan)", color: "#000" }}
          >
            {spec.boundary === "trigger" ? "trig" : "out"}
          </span>
        )}
      </div>

      {/* config inputs (square dots), then value/stream inputs */}
      {configInputs.map((p, i) => (
        <div key={`cfg-${p.name}`} className="absolute left-2.5 flex items-center gap-1.5 text-[10px]" style={{ top: HEADER + 8 + i * HANDLE_GAP }}>
          {renderDot({ port: p, side: "left", color: portFill(p.kind, p.schemaType), square: true, required: p.required, wired: wiredSet.has(p.name), glow: glowSet.has(p.name) })}
          <Settings2 size={9} className="text-muted shrink-0" />
          <span className="text-muted font-mono">{p.name}</span>
          {p.required && <span className={`-ml-1 font-semibold ${wiredSet.has(p.name) ? "text-muted" : "text-[var(--color-neon-amber)]"}`}>*</span>}
        </div>
      ))}
      {spec.inputs.map((p, i) => (
        <div
          key={`in-${p.name}`}
          className="absolute left-2.5 flex items-center gap-1.5 text-[10px]"
          style={{ top: HEADER + 8 + (configInputs.length + i) * HANDLE_GAP }}
        >
          {renderDot({ port: p, side: "left", color: portFill(p.kind, p.schemaType), required: p.required, wired: wiredSet.has(p.name), glow: glowSet.has(p.name) })}
          <span className="text-muted font-mono">{p.name}</span>
          {p.required && <span className={`-ml-1 font-semibold ${wiredSet.has(p.name) ? "text-muted" : "text-[var(--color-neon-amber)]"}`}>*</span>}
        </div>
      ))}

      {/* outputs, then declared control-outs */}
      {spec.outputs.map((p, i) => (
        <div key={`out-${p.name}`} className="absolute right-2.5 flex items-center gap-1.5 text-[10px]" style={{ top: HEADER + 8 + i * HANDLE_GAP }}>
          <span className="text-muted font-mono">{p.name}</span>
          {renderDot({ port: p, side: "right", color: portFill(p.kind, p.schemaType), glow: glowSet.has(p.name) })}
        </div>
      ))}
      {controlOuts.map((co, i) => (
        <div key={`co-${co}`} className="absolute right-2.5 flex items-center gap-1.5 text-[10px]" style={{ top: HEADER + 8 + (spec.outputs.length + i) * HANDLE_GAP }}>
          <span className="text-muted font-mono italic">{co}</span>
          {renderDot({ port: { name: co, kind: "control" }, side: "right", color: "var(--color-port-control)", glow: glowSet.has(co) })}
        </div>
      ))}

      <svg aria-hidden style={{ position: "absolute", left: 0, top: 0, width: NODE_W, height, overflow: "visible", pointerEvents: "none", zIndex: 1 }}>
        <path d={framePath(NODE_W, height, hasControlIn, hasControlOut)} fill="none" stroke={borderColor} strokeWidth={borderWidth} />
      </svg>
    </div>
  );
}
