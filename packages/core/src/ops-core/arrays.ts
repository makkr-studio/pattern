/**
 * §12 — Arrays.
 *
 * Plain ops use `pureOp`. Higher-order ops (`map`/`filter`/`reduce`/`find`/`some`/
 * `every`/`flatMap`/`partition`) take a **sub-workflow reference** applied per
 * element (§12 note). The sub-workflow receives `{ item, index }` (reduce also
 * `{ acc }`) and returns `{ value }`.
 */

import { defineOp, pureOp, required, value, z } from "./helpers.js";
import { deepEqual } from "./scalars.js";
import { getPath } from "./objects.js";
import type { OpDefinition } from "../types.js";

const arr = z.array(z.unknown());
const subworkflowRef = z.union([z.object({ workflowId: z.string() }), z.object({ workflow: z.any() })]);

/** Map items through `fn` with bounded concurrency, preserving order. */
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const limit = Math.max(1, Math.min(concurrency || 1, items.length || 1));
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

const hoConfig = z.object({ workflow: subworkflowRef, concurrency: z.number().int().positive().default(1) });

/** A higher-order op that maps each item through the configured sub-workflow. */
function higherOrder(
  type: string,
  finalize: (results: { item: unknown; index: number; value: unknown }[]) => unknown,
  description: string,
): OpDefinition {
  return defineOp({
    type,
    title: type,
    description,
    inputs: { values: required(arr) },
    outputs: { out: value() },
    config: hoConfig,
    execute: async (ctx) => {
      const values = (await ctx.input.value<unknown[]>("values")) ?? [];
      const { workflow, concurrency } = ctx.config as { workflow: any; concurrency: number };
      const mapped = await mapConcurrent(values, concurrency, async (item, index) => {
        const res = await ctx.invoke(workflow, { item, index });
        return { item, index, value: "value" in res ? res.value : undefined };
      });
      return { out: finalize(mapped) };
    },
  });
}

export const arrayOps: OpDefinition[] = [
  pureOp({ type: "core.array.length", description: "Returns the number of items in `values`.", inputs: { values: required(arr) }, output: z.number(), compute: ({ values }) => (values as unknown[]).length }),
  pureOp({
    type: "core.array.at",
    description: "Returns the item at `config.index` (negative counts from the end).",
    inputs: { values: required(arr) },
    config: z.object({ index: z.number().int() }),
    compute: ({ values }, ctx) => (values as unknown[]).at((ctx.config as { index: number }).index),
  }),
  pureOp({ type: "core.array.first", description: "Returns the first item of `values` (or `undefined` if empty).", inputs: { values: required(arr) }, compute: ({ values }) => (values as unknown[])[0] }),
  pureOp({ type: "core.array.last", description: "Returns the last item of `values` (or `undefined` if empty).", inputs: { values: required(arr) }, compute: ({ values }) => (values as unknown[]).at(-1) }),
  pureOp({
    type: "core.array.slice",
    description: "Returns a sub-array from `config.start` to `config.end` (end exclusive).",
    inputs: { values: required(arr) },
    output: arr,
    config: z.object({ start: z.number().int().default(0), end: z.number().int().optional() }),
    compute: ({ values }, ctx) => {
      const { start, end } = ctx.config as { start: number; end?: number };
      return (values as unknown[]).slice(start, end);
    },
  }),
  pureOp({ type: "core.array.concat", description: "Concatenates arrays `a` and `b` into one array.", inputs: { a: required(arr), b: required(arr) }, output: arr, compute: ({ a, b }) => [...(a as unknown[]), ...(b as unknown[])] }),
  pureOp({ type: "core.array.append", description: "Returns `values` with `item` added to the end.", inputs: { values: required(arr), item: required() }, output: arr, compute: ({ values, item }) => [...(values as unknown[]), item] }),
  pureOp({ type: "core.array.prepend", description: "Returns `values` with `item` added to the front.", inputs: { values: required(arr), item: required() }, output: arr, compute: ({ values, item }) => [item, ...(values as unknown[])] }),
  pureOp({
    type: "core.array.flatten",
    description: "Flattens nested arrays up to `config.depth` levels.",
    inputs: { values: required(arr) },
    output: arr,
    config: z.object({ depth: z.number().int().default(1) }),
    compute: ({ values }, ctx) => (values as unknown[]).flat((ctx.config as { depth: number }).depth),
  }),
  pureOp({
    type: "core.array.unique",
    description: "Returns `values` with deep-equal duplicates removed, keeping first occurrence.",
    inputs: { values: required(arr) },
    output: arr,
    compute: ({ values }) => {
      const out: unknown[] = [];
      for (const v of values as unknown[]) if (!out.some((u) => deepEqual(u, v))) out.push(v);
      return out;
    },
  }),
  pureOp({
    type: "core.array.sort",
    description: "Sort by an optional dot-path key. config: { path?, order: 'asc'|'desc', numeric? }.",
    inputs: { values: required(arr) },
    output: arr,
    config: z.object({ path: z.string().optional(), order: z.enum(["asc", "desc"]).default("asc"), numeric: z.boolean().default(false) }),
    compute: ({ values }, ctx) => {
      const { path, order, numeric } = ctx.config as { path?: string; order: "asc" | "desc"; numeric: boolean };
      const key = (v: unknown) => (path ? getPath(v, path) : v);
      const dir = order === "desc" ? -1 : 1;
      return [...(values as unknown[])].sort((a, b) => {
        const ka = key(a) as any;
        const kb = key(b) as any;
        if (numeric) return (Number(ka) - Number(kb)) * dir;
        return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir;
      });
    },
  }),
  pureOp({ type: "core.array.reverse", description: "Returns a new array with `values` in reverse order.", inputs: { values: required(arr) }, output: arr, compute: ({ values }) => [...(values as unknown[])].reverse() }),
  pureOp({ type: "core.array.includes", description: "Returns `true` if `values` contains a deep-equal `value`.", inputs: { values: required(arr), value: required() }, output: z.boolean(), compute: ({ values, value: v }) => (values as unknown[]).some((x) => deepEqual(x, v)) }),
  pureOp({ type: "core.array.indexOf", description: "Returns the index of the first deep-equal `value`, or `-1` if absent.", inputs: { values: required(arr), value: required() }, output: z.number(), compute: ({ values, value: v }) => (values as unknown[]).findIndex((x) => deepEqual(x, v)) }),
  pureOp({
    type: "core.array.join",
    description: "Joins `values` into a string using `config.separator`.",
    inputs: { values: required(arr) },
    output: z.string(),
    config: z.object({ separator: z.string().default(",") }),
    compute: ({ values }, ctx) => (values as unknown[]).join((ctx.config as { separator: string }).separator),
  }),
  pureOp({
    type: "core.array.chunk",
    description: "Splits `values` into sub-arrays of length `config.size`.",
    inputs: { values: required(arr) },
    output: z.array(arr),
    config: z.object({ size: z.number().int().positive() }),
    compute: ({ values }, ctx) => {
      const { size } = ctx.config as { size: number };
      const vs = values as unknown[];
      const out: unknown[][] = [];
      for (let i = 0; i < vs.length; i += size) out.push(vs.slice(i, i + size));
      return out;
    },
  }),
  pureOp({
    type: "core.array.zip",
    description: "Pairs items of `a` and `b` into `[a, b]` tuples, truncated to the shorter length.",
    inputs: { a: required(arr), b: required(arr) },
    output: z.array(z.tuple([z.unknown(), z.unknown()])),
    compute: ({ a, b }) => {
      const av = a as unknown[];
      const bv = b as unknown[];
      const n = Math.min(av.length, bv.length);
      return Array.from({ length: n }, (_, i) => [av[i], bv[i]]);
    },
  }),
  pureOp({
    type: "core.array.groupBy",
    description: "Group objects by a dot-path key. config: { path }.",
    inputs: { values: required(arr) },
    output: z.record(z.string(), arr),
    config: z.object({ path: z.string() }),
    compute: ({ values }, ctx) => {
      const { path } = ctx.config as { path: string };
      const out: Record<string, unknown[]> = {};
      for (const v of values as unknown[]) {
        const k = String(getPath(v, path));
        (out[k] ??= []).push(v);
      }
      return out;
    },
  }),
  pureOp({
    type: "core.array.count",
    description: "Count items deep-equal to `value` (or total length if `value` unwired).",
    inputs: { values: required(arr), value: value() },
    output: z.number(),
    compute: ({ values, value: v }) =>
      v === undefined ? (values as unknown[]).length : (values as unknown[]).filter((x) => deepEqual(x, v)).length,
  }),
  defineOp({
    type: "core.array.range",
    effects: "pure",
    title: "core.array.range",
    description: "Generate [start, end) stepping by `step`.",
    inputs: {},
    outputs: { out: value(z.array(z.number())) },
    config: z.object({ start: z.number().default(0), end: z.number(), step: z.number().default(1) }),
    execute: (ctx) => {
      const { start, end, step } = ctx.config as { start: number; end: number; step: number };
      const out: number[] = [];
      if (step === 0) throw new Error("range step must not be 0");
      for (let i = start; step > 0 ? i < end : i > end; i += step) out.push(i);
      return { out };
    },
  }),

  // ── Higher-order (sub-workflow per element) ──
  higherOrder("core.array.map", (rs) => rs.map((r) => r.value), "Map each item through a sub-workflow → { value }."),
  higherOrder(
    "core.array.filter",
    (rs) => rs.filter((r) => Boolean(r.value)).map((r) => r.item),
    "Keep items whose sub-workflow returns a truthy { value }.",
  ),
  higherOrder("core.array.flatMap", (rs) => rs.flatMap((r) => (Array.isArray(r.value) ? r.value : [r.value])), "Map then flatten one level."),
  higherOrder("core.array.find", (rs) => rs.find((r) => Boolean(r.value))?.item, "First item whose sub-workflow returns truthy."),
  higherOrder("core.array.some", (rs) => rs.some((r) => Boolean(r.value)), "True if any sub-workflow result is truthy."),
  higherOrder("core.array.every", (rs) => rs.every((r) => Boolean(r.value)), "True if every sub-workflow result is truthy."),
  defineOp({
    type: "core.array.partition",
    title: "core.array.partition",
    description: "Split items by a predicate sub-workflow into { pass, fail }.",
    inputs: { values: required(arr) },
    outputs: { pass: value(arr), fail: value(arr) },
    config: hoConfig,
    execute: async (ctx) => {
      const values = (await ctx.input.value<unknown[]>("values")) ?? [];
      const { workflow, concurrency } = ctx.config as { workflow: any; concurrency: number };
      const results = await mapConcurrent(values, concurrency, async (item, index) => {
        const res = await ctx.invoke(workflow, { item, index });
        return { item, keep: Boolean("value" in res ? res.value : false) };
      });
      return { pass: results.filter((r) => r.keep).map((r) => r.item), fail: results.filter((r) => !r.keep).map((r) => r.item) };
    },
  }),
  defineOp({
    type: "core.array.reduce",
    title: "core.array.reduce",
    description: "Fold items through a sub-workflow ({ acc, item, index } → { value }). config: { workflow, initial }.",
    inputs: { values: required(arr) },
    outputs: { out: value() },
    config: z.object({ workflow: subworkflowRef, initial: z.unknown().optional() }),
    execute: async (ctx) => {
      const values = (await ctx.input.value<unknown[]>("values")) ?? [];
      const { workflow, initial } = ctx.config as { workflow: any; initial?: unknown };
      let acc = initial;
      for (let index = 0; index < values.length; index++) {
        const res = await ctx.invoke(workflow, { acc, item: values[index], index });
        acc = "value" in res ? res.value : acc;
      }
      return { out: acc };
    },
  }),
];
