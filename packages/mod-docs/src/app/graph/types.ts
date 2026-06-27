import type { PortKind } from "./format";

export type { PortKind };

/** A node's execution state during a (faked) run, mirroring the admin's replay. */
export type ReplayState = "idle" | "pending" | "running" | "ok" | "error";

/** One port on a Mini node. `schemaType` colors value dots like the real editor. */
export interface MiniPort {
  name: string;
  kind: PortKind;
  /** JSON type for value ports ("string" | "number" | "object" | ...). */
  schemaType?: string;
  required?: boolean;
}

/** A node in a static Mini graph — everything the renderer needs, no registry. */
export interface MiniNodeSpec {
  id: string;
  /** Namespaced op type — drives the header tint + icon via categories.ts. */
  op: string;
  /** Friendly header label (defaults to the op's last segment). */
  title?: string;
  boundary?: "trigger" | "outgate";
  /** Registration-time config ports (square dots), wired like value inputs. */
  configInputs?: MiniPort[];
  inputs: MiniPort[];
  outputs: MiniPort[];
  /** Declared named control-outs (branch/switch paths). */
  controlOuts?: string[];
  /** Canvas position. */
  pos: { x: number; y: number };
}

/** An edge between two ports. The kind is authored explicitly (no lookup). */
export interface MiniEdgeSpec {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
  kind: PortKind;
}

export interface MiniGraph {
  nodes: MiniNodeSpec[];
  edges: MiniEdgeSpec[];
}

/** Runtime decoration applied to a node during the quest / fake run. */
export interface MiniNodeRuntime {
  replay?: ReplayState;
  /** Port names to highlight (connect-assist: "wire here"). */
  glow?: string[];
  /** Port names already wired (required marks go calm). */
  wired?: string[];
  selected?: boolean;
}
