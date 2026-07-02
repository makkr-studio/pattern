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
    description: "Reads `config.path` (dot/bracket path) from the input `object`, or `undefined` if missing.",
    inputs: { object: required(obj) },
    config: pathConfig,
    compute: ({ object }, ctx) => getPath(object, (ctx.config as { path: string }).path),
  }),
  pureOp({
    type: "core.object.set",
    description: "Returns a clone of `object` with `config.path` (dot/bracket path) set to `value` (immutable).",
    inputs: { object: required(obj), value: required() },
    output: obj,
    config: pathConfig,
    compute: ({ object, value: v }, ctx) => setPath(object, (ctx.config as { path: string }).path, v),
  }),
  pureOp({
    type: "core.object.has",
    description: "Returns `true` if `config.path` (dot/bracket path) exists in `object`.",
    inputs: { object: required(obj) },
    output: z.boolean(),
    config: pathConfig,
    compute: ({ object }, ctx) => getPath(object, (ctx.config as { path: string }).path) !== undefined,
  }),
  pureOp({
    type: "core.object.delete",
    description: "Returns a clone of `object` with `config.path` (dot/bracket path) removed (immutable).",
    inputs: { object: required(obj) },
    output: obj,
    config: pathConfig,
    compute: ({ object }, ctx) => deletePath(object, (ctx.config as { path: string }).path),
  }),
  pureOp({
    type: "core.object.pick",
    description: "Returns a new object keeping only `config.keys` present in `object`.",
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
    description: "Returns a new object dropping `config.keys` from `object`.",
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
    description: "Recursively merges `b` into `a` (arrays concatenate, nested objects merge, scalars from `b` win).",
    inputs: { a: required(obj), b: required(obj) },
    output: obj,
    compute: ({ a, b }) => mergeDeep(a, b),
  }),
  pureOp({ type: "core.object.keys", description: "Returns the own enumerable keys of `object` as a string array.", inputs: { object: required(obj) }, output: z.array(z.string()), compute: ({ object }) => Object.keys(object as object) }),
  pureOp({ type: "core.object.values", description: "Returns the own enumerable values of `object` as an array.", inputs: { object: required(obj) }, output: z.array(z.unknown()), compute: ({ object }) => Object.values(object as object) }),
  pureOp({ type: "core.object.entries", description: "Returns the own enumerable `[key, value]` pairs of `object`.", inputs: { object: required(obj) }, output: z.array(z.tuple([z.string(), z.unknown()])), compute: ({ object }) => Object.entries(object as object) }),
  pureOp({
    type: "core.object.fromEntries",
    description: "Builds an object from an array of `[key, value]` `entries`.",
    inputs: { entries: required(z.array(z.tuple([z.string(), z.unknown()]))) },
    output: obj,
    compute: ({ entries }) => Object.fromEntries(entries as [string, unknown][]),
  }),
  pureOp({ type: "core.object.clone", description: "Returns a deep clone of `object` via `structuredClone`.", inputs: { object: required() }, compute: ({ object }) => structuredClone(object) }),
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
    description:
      "Assemble an object by mapping the named input ports → keys. Each key in config.keys becomes an input port; unwired keys are omitted.",
    inputs: (config: { keys?: string[] }): Ports =>
      Object.fromEntries((config.keys ?? ["value"]).map((k) => [k, value()])),
    outputs: { out: value(obj) },
    // Default gives a fresh node one visible port instead of zero — rename/add
    // keys and the ports follow (the editor re-resolves ports from config).
    config: z.object({ keys: z.array(z.string()).default(["value"]) }),
    execute: async (ctx) => {
      const { keys } = ctx.config as { keys: string[] };
      const entries = await Promise.all(keys.map(async (k) => [k, await ctx.input.value(k)] as const));
      return { out: Object.fromEntries(entries) };
    },
  }),
  defineOp({
    type: "core.object.extract",
    title: "core.object.extract",
    description:
      "Extract values from the input `object` into one output port per config.keys entry (the inverse of core.object.build). Missing keys output undefined. Use it to decompose a request body/params into discrete op inputs.",
    inputs: { object: required(obj) },
    // One output port per key — the editor re-resolves ports from config, same
    // as build's inputs. Default keeps a fresh node showing one visible port.
    outputs: (config: { keys?: string[] }): Ports => Object.fromEntries((config.keys ?? ["value"]).map((k) => [k, value()])),
    config: z.object({ keys: z.array(z.string()).default(["value"]) }),
    execute: async (ctx) => {
      const { keys } = ctx.config as { keys: string[] };
      const source = (await ctx.input.value<Record<string, unknown>>("object")) ?? {};
      return Object.fromEntries(keys.map((k) => [k, source[k]]));
    },
  }),
];
