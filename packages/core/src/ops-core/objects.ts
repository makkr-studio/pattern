/**
 * §12 — Objects.
 *
 * `get`/`set`/`has`/`delete` take a dot/bracket `path` in config; mutating ops
 * are immutable (they return a clone). `build` assembles an object from a set of
 * input ports named by config. `mapValues` maps each value through a referenced
 * sub-workflow (the higher-order note in §12).
 */

import { defineOp, pureOp, required, value, z } from "./helpers.js";
import type { OpDefinition, Ports } from "../types.js";

const obj = z.record(z.string(), z.unknown());

/** Parse a dot/bracket path ("a.b[0].c") into tokens. */
export function parsePath(path: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  for (const part of String(path).split(".")) {
    if (!part) continue;
    const re = /([^[\]]+)|\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(part))) {
      if (m[2] !== undefined) tokens.push(Number(m[2]));
      else if (m[1] !== undefined) tokens.push(m[1]);
    }
  }
  return tokens;
}

/** Read `path` from `source`, returning undefined if any step is missing. */
export function getPath(source: unknown, path: string): unknown {
  let cur: any = source;
  for (const t of parsePath(path)) {
    if (cur == null) return undefined;
    cur = cur[t];
  }
  return cur;
}

/** Return a clone of `source` with `path` set to `val` (immutable). */
export function setPath(source: unknown, path: string, val: unknown): unknown {
  const tokens = parsePath(path);
  if (tokens.length === 0) return val;
  const root: any = Array.isArray(source) ? [...source] : { ...(source as object) };
  let cur = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1]!;
    const existing = cur[t];
    const clone = Array.isArray(existing)
      ? [...existing]
      : existing && typeof existing === "object"
        ? { ...existing }
        : typeof next === "number"
          ? []
          : {};
    cur[t] = clone;
    cur = clone;
  }
  cur[tokens[tokens.length - 1]!] = val;
  return root;
}

function deletePath(source: unknown, path: string): unknown {
  const tokens = parsePath(path);
  if (tokens.length === 0) return source;
  const root: any = Array.isArray(source) ? [...source] : { ...(source as object) };
  let cur = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]!;
    if (cur[t] == null) return root;
    const clone = Array.isArray(cur[t]) ? [...cur[t]] : { ...cur[t] };
    cur[t] = clone;
    cur = clone;
  }
  const last = tokens[tokens.length - 1]!;
  if (Array.isArray(cur)) cur.splice(Number(last), 1);
  else delete cur[last];
  return root;
}

function mergeDeep(a: any, b: any): any {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const out: any = { ...a };
    for (const k of Object.keys(b)) out[k] = k in a ? mergeDeep(a[k], b[k]) : b[k];
    return out;
  }
  return b;
}

const pathConfig = z.object({ path: z.string() });

export const objectOps: OpDefinition[] = [
  pureOp({
    type: "core.object.get",
    inputs: { object: required(obj) },
    config: pathConfig,
    compute: ({ object }, ctx) => getPath(object, (ctx.config as { path: string }).path),
  }),
  pureOp({
    type: "core.object.set",
    inputs: { object: required(obj), value: required() },
    output: obj,
    config: pathConfig,
    compute: ({ object, value: v }, ctx) => setPath(object, (ctx.config as { path: string }).path, v),
  }),
  pureOp({
    type: "core.object.has",
    inputs: { object: required(obj) },
    output: z.boolean(),
    config: pathConfig,
    compute: ({ object }, ctx) => getPath(object, (ctx.config as { path: string }).path) !== undefined,
  }),
  pureOp({
    type: "core.object.delete",
    inputs: { object: required(obj) },
    output: obj,
    config: pathConfig,
    compute: ({ object }, ctx) => deletePath(object, (ctx.config as { path: string }).path),
  }),
  pureOp({
    type: "core.object.pick",
    inputs: { object: required(obj) },
    output: obj,
    config: z.object({ keys: z.array(z.string()) }),
    compute: ({ object }, ctx) => {
      const { keys } = ctx.config as { keys: string[] };
      const out: Record<string, unknown> = {};
      for (const k of keys) if (k in (object as object)) out[k] = (object as any)[k];
      return out;
    },
  }),
  pureOp({
    type: "core.object.omit",
    inputs: { object: required(obj) },
    output: obj,
    config: z.object({ keys: z.array(z.string()) }),
    compute: ({ object }, ctx) => {
      const { keys } = ctx.config as { keys: string[] };
      const drop = new Set(keys);
      return Object.fromEntries(Object.entries(object as object).filter(([k]) => !drop.has(k)));
    },
  }),
  pureOp({
    type: "core.object.merge",
    description: "Shallow merge (b over a).",
    inputs: { a: required(obj), b: required(obj) },
    output: obj,
    compute: ({ a, b }) => ({ ...(a as object), ...(b as object) }),
  }),
  pureOp({
    type: "core.object.mergeDeep",
    inputs: { a: required(obj), b: required(obj) },
    output: obj,
    compute: ({ a, b }) => mergeDeep(a, b),
  }),
  pureOp({ type: "core.object.keys", inputs: { object: required(obj) }, output: z.array(z.string()), compute: ({ object }) => Object.keys(object as object) }),
  pureOp({ type: "core.object.values", inputs: { object: required(obj) }, output: z.array(z.unknown()), compute: ({ object }) => Object.values(object as object) }),
  pureOp({ type: "core.object.entries", inputs: { object: required(obj) }, output: z.array(z.tuple([z.string(), z.unknown()])), compute: ({ object }) => Object.entries(object as object) }),
  pureOp({
    type: "core.object.fromEntries",
    inputs: { entries: required(z.array(z.tuple([z.string(), z.unknown()]))) },
    output: obj,
    compute: ({ entries }) => Object.fromEntries(entries as [string, unknown][]),
  }),
  pureOp({ type: "core.object.clone", inputs: { object: required() }, compute: ({ object }) => structuredClone(object) }),
  defineOp({
    type: "core.object.mapValues",
    title: "core.object.mapValues",
    description: "Map each value through a referenced sub-workflow ({ value, key } → { value }).",
    inputs: { object: required(obj) },
    outputs: { out: value(obj) },
    config: z.object({ workflow: z.union([z.object({ workflowId: z.string() }), z.object({ workflow: z.any() })]) }),
    execute: async (ctx) => {
      const object = (await ctx.input.value<Record<string, unknown>>("object")) ?? {};
      const ref = (ctx.config as { workflow: any }).workflow;
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(object)) {
        const res = await ctx.invoke(ref, { value: val, key });
        out[key] = "value" in res ? res.value : val;
      }
      return { out };
    },
  }),
  defineOp({
    type: "core.object.build",
    title: "core.object.build",
    description: "Assemble an object by mapping the named input ports → keys. config: { keys: string[] }.",
    inputs: (config: { keys?: string[] }): Ports =>
      Object.fromEntries((config.keys ?? []).map((k) => [k, value()])),
    outputs: { out: value(obj) },
    config: z.object({ keys: z.array(z.string()) }),
    execute: async (ctx) => {
      const { keys } = ctx.config as { keys: string[] };
      const entries = await Promise.all(keys.map(async (k) => [k, await ctx.input.value(k)] as const));
      return { out: Object.fromEntries(entries) };
    },
  }),
];
