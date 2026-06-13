/**
 * @pattern/mod-docs — shapes shared between the backend and the SPA.
 *
 * `DocsNavItem` mirrors @pattern/core's contract (re-declared here so the app
 * bundle never imports core). Phase B adds the introspection shapes
 * (OpInfo/PortInfo/ModInfo) used by the generated reference.
 */

export interface DocsNavItem {
  label: string;
  file: string;
  order?: number;
  items?: DocsNavItem[];
}

/* ── introspection shapes (docs copy of mod-admin/src/backend/introspect.ts
      contracts — kept in sync by convention, not import: the docs app bundle
      must not depend on the admin) ──────────────────────────────────────── */

export interface PortInfo {
  name: string;
  kind: "value" | "stream" | "control";
  required?: boolean;
  description?: string;
  schema?: unknown;
  /** What flows through a value/stream port ("string", "object", "string[]", "any"…). */
  dataType?: string;
}

export interface OpInfo {
  type: string;
  title?: string;
  description?: string;
  category: string;
  boundary?: "trigger" | "outgate";
  pair?: string;
  /** The mod that contributed this op (undefined = base catalog). */
  mod?: string;
  inputs: PortInfo[];
  outputs: PortInfo[];
  configInputs: PortInfo[];
  controlOut: string[];
  configSchema?: unknown;
  usedBy: number;
  usedByWorkflows: string[];
  reusable: boolean;
}

export interface ModInfo {
  name: string;
  ops: string[];
  workflows: string[];
  /** Docs chapter slug when the mod contributes one. */
  chapter?: string;
}
