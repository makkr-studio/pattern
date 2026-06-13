/**
 * Shared port-hover state for the editor canvas. Hovering a port — its colored
 * dot, OR (for a portaled wire) one of its `name ▸` glyphs — lights up EVERY
 * edge attached to that port and the ports at the far ends.
 *
 * Why a module-global store and not props: the node handles (OpNode), the wires
 * (FlowEdge) and the portal glyphs (PortalEdge) are each rendered in separate
 * React subtrees by xyflow, so they can't share hover by prop-threading. Keying
 * hover by PORT — not by glyph or edge — is also what fixes the portal bug: a
 * port with several outgoing edges, each portaled, stacks several glyphs at the
 * same point, and only the topmost used to receive hover (so you saw just one
 * of its wires). Hover-by-port lights all the siblings at once.
 */

import { useNodeConnections } from "@xyflow/react";
import { create } from "zustand";

/** A port endpoint: a `source` is an output (right side), a `target` an input (left side). */
export interface PortRef {
  node: string;
  port: string;
  end: "source" | "target";
}

export function samePort(a: PortRef, b: PortRef): boolean {
  return a.node === b.node && a.port === b.port && a.end === b.end;
}

interface HoverState {
  hovered: PortRef | null;
  setHover: (ref: PortRef) => void;
  /** Clear — guarded so a `leave` from one port can't wipe a fresh `enter` on
   *  another (mouse leave/enter ordering across adjacent ports is not fixed). */
  clear: (ref?: PortRef) => void;
}

export const usePortHover = create<HoverState>((set) => ({
  hovered: null,
  setHover: (ref) => set({ hovered: ref }),
  clear: (ref) => set((s) => (!ref || (s.hovered && samePort(s.hovered, ref)) ? { hovered: null } : s)),
}));

/** A port glows when it IS the hovered port, or shares an edge with it. Reads
 *  its own connections, so the far end of every wire from the hovered port —
 *  normal or portaled — lights up too. */
export function usePortActive(ref: PortRef): boolean {
  const hovered = usePortHover((s) => s.hovered);
  const connections = useNodeConnections({ handleType: ref.end, handleId: ref.port });
  if (!hovered) return false;
  if (samePort(hovered, ref)) return true;
  return connections.some((c) => {
    const far: PortRef =
      ref.end === "source"
        ? { node: c.target, port: c.targetHandle ?? "", end: "target" }
        : { node: c.source, port: c.sourceHandle ?? "", end: "source" };
    return samePort(far, hovered);
  });
}

/** A port handle's glow state + the enter/leave wiring, in one call. The dot
 *  (xyflow `Handle`) carries the listeners so it composes with the row's
 *  tooltip handlers rather than clobbering them. */
export function usePortHandlers(ref: PortRef): {
  active: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
} {
  const setHover = usePortHover((s) => s.setHover);
  const clear = usePortHover((s) => s.clear);
  const active = usePortActive(ref);
  return { active, onMouseEnter: () => setHover(ref), onMouseLeave: () => clear(ref) };
}

/** An edge is active when either endpoint is the hovered port (matched on the
 *  hovered end — output hover lights its out-edges, input hover its in-edges). */
export function useEdgeActive(
  source: string,
  sourceHandle: string | null | undefined,
  target: string,
  targetHandle: string | null | undefined,
): boolean {
  const hovered = usePortHover((s) => s.hovered);
  if (!hovered) return false;
  return hovered.end === "source"
    ? hovered.node === source && hovered.port === (sourceHandle ?? "")
    : hovered.node === target && hovered.port === (targetHandle ?? "");
}
