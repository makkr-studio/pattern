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

const binNum = (type: string, description: string, fn: (a: number, b: number) => number): OpDefinition =>
  pureOp({
    type,
    description,
    inputs: { a: required(num), b: required(num) },
    output: num,
    compute: ({ a, b }) => fn(asNumber(a, "a"), asNumber(b, "b")),
  });

const unNum = (type: string, description: string, fn: (a: number) => number): OpDefinition =>
  pureOp({
    type,
    description,
    inputs: { a: required(num) },
    output: num,
    compute: ({ a }) => fn(asNumber(a, "a")),
  });

export const mathOps: OpDefinition[] = [
  binNum("core.math.add", "Sum of two numbers. Inputs { `a`, `b` }.", (a, b) => a + b),
  binNum("core.math.subtract", "Difference `a - b` of two numbers. Inputs { `a`, `b` }.", (a, b) => a - b),
  binNum("core.math.multiply", "Product of two numbers. Inputs { `a`, `b` }.", (a, b) => a * b),
  binNum("core.math.divide", "Quotient `a / b`; throws on division by zero. Inputs { `a`, `b` }.", (a, b) => {
    if (b === 0) throw new Error("division by zero");
    return a / b;
  }),
  binNum("core.math.modulo", "Remainder of `a % b`. Inputs { `a`, `b` }.", (a, b) => a % b),
  binNum("core.math.pow", "`a` raised to the power `b`. Inputs { `a`, `b` }.", (a, b) => a ** b),
  binNum("core.math.min", "Smaller of two numbers. Inputs { `a`, `b` }.", (a, b) => Math.min(a, b)),
  binNum("core.math.max", "Larger of two numbers. Inputs { `a`, `b` }.", (a, b) => Math.max(a, b)),
  unNum("core.math.abs", "Absolute value of a number. Input { `a` }.", Math.abs),
  unNum("core.math.round", "Rounds a number to the nearest integer. Input { `a` }.", Math.round),
  unNum("core.math.floor", "Rounds a number down to the nearest integer. Input { `a` }.", Math.floor),
  unNum("core.math.ceil", "Rounds a number up to the nearest integer. Input { `a` }.", Math.ceil),
  pureOp({
    type: "core.math.clamp",
    description: "Constrains `value` to the range [`min`, `max`]. Inputs { `value`, `min`, `max` }.",
    inputs: { value: required(num), min: required(num), max: required(num) },
    output: num,
    compute: ({ value: v, min, max }) => Math.min(Math.max(asNumber(v), asNumber(min)), asNumber(max)),
  }),
  pureOp({
    type: "core.math.fib",
    description:
      "Naive recursive fibonacci(`n`), deliberately CPU-bound (exponential). Exists for benchmarks and " +
      "demos: it makes event-loop blocking visible and gives worker transports something to chew on.",
    inputs: { n: value(num) },
    output: num,
    config: z.object({ n: z.number().int().min(1).max(42).default(34) }),
    compute: ({ n }, ctx) => {
      const k = n == null ? (ctx.config as { n: number }).n : asNumber(n, "n");
      const fib = (i: number): number => (i < 2 ? i : fib(i - 1) + fib(i - 2));
      return fib(Math.min(42, Math.max(1, Math.floor(k))));
    },
  }),
];

const cmp = (type: string, description: string, fn: (a: any, b: any) => boolean): OpDefinition =>
  pureOp({
    type,
    description,
    inputs: { a: required(), b: required() },
    output: bool,
    compute: ({ a, b }) => fn(a, b),
  });

export const cmpOps: OpDefinition[] = [
  cmp("core.cmp.eq", "True when `a` and `b` are structurally (deeply) equal. Inputs { `a`, `b` }.", deepEqual),
  cmp("core.cmp.neq", "True when `a` and `b` are not structurally (deeply) equal. Inputs { `a`, `b` }.", (a, b) => !deepEqual(a, b)),
  cmp("core.cmp.gt", "True when `a` is greater than `b`. Inputs { `a`, `b` }.", (a, b) => a > b),
  cmp("core.cmp.gte", "True when `a` is greater than or equal to `b`. Inputs { `a`, `b` }.", (a, b) => a >= b),
  cmp("core.cmp.lt", "True when `a` is less than `b`. Inputs { `a`, `b` }.", (a, b) => a < b),
  cmp("core.cmp.lte", "True when `a` is less than or equal to `b`. Inputs { `a`, `b` }.", (a, b) => a <= b),
];

export const boolOps: OpDefinition[] = [
  pureOp({
    type: "core.bool.and",
    description: "Logical AND of two booleans. Inputs { `a`, `b` }.",
    inputs: { a: required(bool), b: required(bool) },
    output: bool,
    compute: ({ a, b }) => Boolean(a) && Boolean(b),
  }),
  pureOp({
    type: "core.bool.or",
    description: "Logical OR of two booleans. Inputs { `a`, `b` }.",
    inputs: { a: required(bool), b: required(bool) },
    output: bool,
    compute: ({ a, b }) => Boolean(a) || Boolean(b),
  }),
  pureOp({
    type: "core.bool.not",
    description: "Logical negation of a boolean. Input { `a` }.",
    inputs: { a: required(bool) },
    output: bool,
    compute: ({ a }) => !a,
  }),
  pureOp({
    type: "core.bool.xor",
    description: "Logical exclusive-OR of two booleans. Inputs { `a`, `b` }.",
    inputs: { a: required(bool), b: required(bool) },
    output: bool,
    compute: ({ a, b }) => Boolean(a) !== Boolean(b),
  }),
];

export const castOps: OpDefinition[] = [
  pureOp({
    type: "core.cast.toString",
    description: "Coerces `value` to a string; objects are JSON-stringified and null/undefined become `\"\"`. Input { `value` }.",
    inputs: { value: required() },
    output: z.string(),
    compute: ({ value: v }) => (typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)),
  }),
  pureOp({
    type: "core.cast.toNumber",
    description: "Coerces `value` to a number. Input { `value` }.",
    inputs: { value: required() },
    output: num,
    compute: ({ value: v }) => Number(v),
  }),
  pureOp({
    type: "core.cast.toBoolean",
    description: "Coerces `value` to a boolean by truthiness. Input { `value` }.",
    inputs: { value: required() },
    output: bool,
    compute: ({ value: v }) => Boolean(v),
  }),
  pureOp({
    type: "core.cast.typeof",
    description: "Runtime type tag of `value` (`\"null\"`, `\"array\"`, or `typeof`). Input { `value` }.",
    inputs: { value: required() },
    output: z.string(),
    compute: ({ value: v }) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v),
  }),
  pureOp({
    type: "core.cast.isNull",
    description: "True when `value` is null or undefined. Input { `value` }.",
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

/** Value-level conditionals — pure, no control branch / sub-run, so they're
 *  legal inside a per-chunk stream region (the no-branch way to filter/choose). */
const valueOps: OpDefinition[] = [
  pureOp({
    type: "core.value.keep",
    description:
      "Pass `value` through when `when` is true, else `undefined`. Inside a core.stream.each region that DROPS the chunk (collect ignores undefined), the no-branch way to skip or filter. Inputs { value, when }.",
    inputs: { value: value(), when: required(bool) },
    compute: ({ value: v, when }) => (when ? v : undefined),
  }),
  pureOp({
    type: "core.value.select",
    description:
      "Value-level ternary: `cond ? then : else` (else is `undefined` when unwired, so it filters too). Runs inline with no control branch or sub-run, so it works inside a stream region. Inputs { cond, then, else }.",
    inputs: { cond: required(bool), then: value(), else: value() },
    compute: ({ cond, then, else: els }) => (cond ? then : els),
  }),
];

export const scalarOps: OpDefinition[] = [...mathOps, ...cmpOps, ...boolOps, ...castOps, ...valueOps];
