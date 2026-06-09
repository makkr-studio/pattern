/**
 * §12 — Scalars: math, comparison, boolean logic, coercion.
 *
 * Binary numeric ops take `{ a, b }`; unary ops take `{ a }`. Comparisons return
 * a boolean. `eq`/`neq` use structural (deep) equality so objects/arrays compare
 * by value.
 */

import { asNumber, pureOp, required, value, z } from "./helpers.js";
import type { OpDefinition } from "../types.js";

const num = z.number();
const bool = z.boolean();

/** Structural deep equality for JSON-ish values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}

const binNum = (type: string, fn: (a: number, b: number) => number): OpDefinition =>
  pureOp({
    type,
    inputs: { a: required(num), b: required(num) },
    output: num,
    compute: ({ a, b }) => fn(asNumber(a, "a"), asNumber(b, "b")),
  });

const unNum = (type: string, fn: (a: number) => number): OpDefinition =>
  pureOp({
    type,
    inputs: { a: required(num) },
    output: num,
    compute: ({ a }) => fn(asNumber(a, "a")),
  });

export const mathOps: OpDefinition[] = [
  binNum("core.math.add", (a, b) => a + b),
  binNum("core.math.subtract", (a, b) => a - b),
  binNum("core.math.multiply", (a, b) => a * b),
  binNum("core.math.divide", (a, b) => {
    if (b === 0) throw new Error("division by zero");
    return a / b;
  }),
  binNum("core.math.modulo", (a, b) => a % b),
  binNum("core.math.pow", (a, b) => a ** b),
  binNum("core.math.min", (a, b) => Math.min(a, b)),
  binNum("core.math.max", (a, b) => Math.max(a, b)),
  unNum("core.math.abs", Math.abs),
  unNum("core.math.round", Math.round),
  unNum("core.math.floor", Math.floor),
  unNum("core.math.ceil", Math.ceil),
  pureOp({
    type: "core.math.clamp",
    inputs: { value: required(num), min: required(num), max: required(num) },
    output: num,
    compute: ({ value: v, min, max }) => Math.min(Math.max(asNumber(v), asNumber(min)), asNumber(max)),
  }),
];

const cmp = (type: string, fn: (a: any, b: any) => boolean): OpDefinition =>
  pureOp({
    type,
    inputs: { a: required(), b: required() },
    output: bool,
    compute: ({ a, b }) => fn(a, b),
  });

export const cmpOps: OpDefinition[] = [
  cmp("core.cmp.eq", deepEqual),
  cmp("core.cmp.neq", (a, b) => !deepEqual(a, b)),
  cmp("core.cmp.gt", (a, b) => a > b),
  cmp("core.cmp.gte", (a, b) => a >= b),
  cmp("core.cmp.lt", (a, b) => a < b),
  cmp("core.cmp.lte", (a, b) => a <= b),
];

export const boolOps: OpDefinition[] = [
  pureOp({
    type: "core.bool.and",
    inputs: { a: required(bool), b: required(bool) },
    output: bool,
    compute: ({ a, b }) => Boolean(a) && Boolean(b),
  }),
  pureOp({
    type: "core.bool.or",
    inputs: { a: required(bool), b: required(bool) },
    output: bool,
    compute: ({ a, b }) => Boolean(a) || Boolean(b),
  }),
  pureOp({
    type: "core.bool.not",
    inputs: { a: required(bool) },
    output: bool,
    compute: ({ a }) => !a,
  }),
  pureOp({
    type: "core.bool.xor",
    inputs: { a: required(bool), b: required(bool) },
    output: bool,
    compute: ({ a, b }) => Boolean(a) !== Boolean(b),
  }),
];

export const castOps: OpDefinition[] = [
  pureOp({
    type: "core.cast.toString",
    inputs: { value: required() },
    output: z.string(),
    compute: ({ value: v }) => (typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)),
  }),
  pureOp({
    type: "core.cast.toNumber",
    inputs: { value: required() },
    output: num,
    compute: ({ value: v }) => Number(v),
  }),
  pureOp({
    type: "core.cast.toBoolean",
    inputs: { value: required() },
    output: bool,
    compute: ({ value: v }) => Boolean(v),
  }),
  pureOp({
    type: "core.cast.typeof",
    inputs: { value: required() },
    output: z.string(),
    compute: ({ value: v }) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v),
  }),
  pureOp({
    type: "core.cast.isNull",
    inputs: { value: required() },
    output: bool,
    compute: ({ value: v }) => v === null || v === undefined,
  }),
  pureOp({
    type: "core.cast.coalesce",
    description: "First non-null/undefined of the wired inputs a, b, c (in order).",
    inputs: { a: value(), b: value(), c: value() },
    compute: ({ a, b, c }) => [a, b, c].find((v) => v !== null && v !== undefined) ?? null,
  }),
];

export const scalarOps: OpDefinition[] = [...mathOps, ...cmpOps, ...boolOps, ...castOps];
