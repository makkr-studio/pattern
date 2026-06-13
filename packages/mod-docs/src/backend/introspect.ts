/**
 * @pattern/mod-docs — engine introspection for the GENERATED reference.
 *
 * A focused copy of mod-admin/src/backend/introspect.ts (opList/opGet/modList)
 * — copied, not imported, so the docs host never depends on the admin. Pure
 * functions over the public engine API; if the admin's copy grows new fields
 * worth documenting, mirror them here (cross-reference comments both sides).
 */

import {
  resolveControlOuts,
  resolvePorts,
  z,
  type Engine,
  type OpDefinition,
} from "@pattern/core";
import type { ModInfo, OpInfo, PortInfo } from "../shared/types.js";

/** Derive a display category from an op type id. */
export function categoryOf(type: string): string {
  const parts = type.split(".");
  if (parts[0] === "core") return parts[1] ?? "core";
  if (parts[0] === "boundary") return "boundary";
  return parts[0] ?? "misc";
}

function jsonSchema(schema: z.ZodType | undefined): unknown {
  if (!schema) return undefined;
  try {
    return z.toJSONSchema(schema, { unrepresentable: "any" } as never);
  } catch {
    return undefined;
  }
}

/**
 * A human label for what FLOWS through a port, derived from its JSON schema —
 * "string" / "number" / "object" / "string[]" / "string | number" / "any".
 * Control ports carry nothing; missing/unconstrained schemas are "any".
 */
export function dataTypeOf(schema: unknown): string {
  const of = (s: unknown): string => {
    if (!s || typeof s !== "object") return "any";
    const o = s as Record<string, unknown>;
    if (Array.isArray(o.type)) return (o.type as string[]).join(" | ");
    if (o.type === "array") {
      const item = o.items ? of(o.items) : "any";
      return item === "any" ? "array" : `${item}[]`;
    }
    if (typeof o.type === "string") return o.type;
    const union = (o.anyOf ?? o.oneOf) as unknown[] | undefined;
    if (union) {
      const parts = [...new Set(union.map(of))];
      return parts.length <= 3 ? parts.join(" | ") : "any";
    }
    if (o.properties || o.additionalProperties) return "object";
    if (o.enum) return "enum";
    if (o.const !== undefined) return JSON.stringify(o.const);
    return "any";
  };
  return of(schema);
}

function portInfos(def: OpDefinition["inputs"], config: unknown): PortInfo[] {
  return Object.entries(resolvePorts(def, config)).map(([name, spec]) => {
    const schema = jsonSchema(spec.schema);
    return {
      name,
      kind: spec.kind,
      required: spec.required,
      description: spec.description,
      schema,
      // Control ports are dataless; value/stream ports show what flows.
      dataType: spec.kind === "control" ? undefined : dataTypeOf(schema),
    };
  });
}

function usedByWorkflows(engine: Engine, type: string): string[] {
  const ids: string[] = [];
  for (const wf of engine.workflows.list()) if (wf.nodes.some((node) => node.op === type)) ids.push(wf.id);
  return ids.sort();
}

function modOf(engine: Engine, type: string): string | undefined {
  for (const m of engine.installedMods()) if (m.opTypes.includes(type)) return m.name;
  return undefined;
}

export function opInfo(engine: Engine, op: OpDefinition): OpInfo {
  const usedBy = usedByWorkflows(engine, op.type);
  return {
    type: op.type,
    title: op.title,
    description: op.description,
    category: categoryOf(op.type),
    boundary: op.boundary,
    pair: op.pair,
    mod: modOf(engine, op.type),
    inputs: portInfos(op.inputs, {}),
    outputs: portInfos(op.outputs, {}),
    configInputs: op.configInputs ? portInfos(op.configInputs, {}) : [],
    controlOut: resolveControlOuts(op, {}),
    configSchema: jsonSchema(op.config),
    usedBy: usedBy.length,
    usedByWorkflows: usedBy,
    reusable: op.reusable !== false,
  };
}

export function opList(engine: Engine): OpInfo[] {
  return engine.ops
    .list()
    .map((op) => opInfo(engine, op))
    .sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
}

/** The list view (and the embeds' OpMap) — port kinds without the schemas. */
export function opListTrimmed(engine: Engine): OpInfo[] {
  const strip = (ports: PortInfo[]) => ports.map(({ schema: _schema, ...p }) => p);
  return opList(engine).map((info) => ({
    ...info,
    inputs: strip(info.inputs),
    outputs: strip(info.outputs),
    configInputs: strip(info.configInputs),
    configSchema: undefined,
    usedByWorkflows: [],
  }));
}

export function opGet(engine: Engine, type: string): OpInfo | null {
  const op = engine.ops.get(type);
  return op ? opInfo(engine, op) : null;
}

export function modList(engine: Engine, chapterOf: (mod: string) => string | undefined): ModInfo[] {
  return engine.installedMods().map((m) => ({
    name: m.name,
    ops: m.opTypes,
    workflows: m.workflowIds,
    chapter: chapterOf(m.name),
  }));
}
