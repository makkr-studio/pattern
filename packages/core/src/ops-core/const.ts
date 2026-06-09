/**
 * §12 — Constants / sources.
 *
 * Each emits a configured literal (or a run-scoped parameter) on its `out` port.
 * Sources have no inputs, so they run immediately at the start of a run.
 */

import { defineOp, value, z } from "./helpers.js";
import type { OpDefinition } from "../types.js";

const literal = (type: string, schema: z.ZodType, configKey = "value"): OpDefinition =>
  defineOp({
    type,
    title: type,
    inputs: {},
    outputs: { out: value(schema) },
    config: z.object({ [configKey]: schema }),
    execute: (ctx) => ({ out: (ctx.config as Record<string, unknown>)[configKey] }),
  });

export const constString = literal("core.const.string", z.string());
export const constNumber = literal("core.const.number", z.number());
export const constBoolean = literal("core.const.boolean", z.boolean());

export const constNull = defineOp({
  type: "core.const.null",
  title: "core.const.null",
  inputs: {},
  outputs: { out: value(z.null()) },
  execute: () => ({ out: null }),
});

export const constObject = defineOp({
  type: "core.const.object",
  title: "core.const.object",
  inputs: {},
  outputs: { out: value(z.record(z.string(), z.unknown())) },
  config: z.object({ value: z.record(z.string(), z.unknown()) }),
  execute: (ctx) => ({ out: (ctx.config as { value: unknown }).value }),
});

export const constArray = defineOp({
  type: "core.const.array",
  title: "core.const.array",
  inputs: {},
  outputs: { out: value(z.array(z.unknown())) },
  config: z.object({ value: z.array(z.unknown()) }),
  execute: (ctx) => ({ out: (ctx.config as { value: unknown }).value }),
});

export const constJson = defineOp({
  type: "core.const.json",
  title: "core.const.json",
  description: "Arbitrary JSON literal, optionally validated against a declared schema at author time.",
  inputs: {},
  outputs: { out: value(z.unknown()) },
  config: z.object({ value: z.unknown() }),
  execute: (ctx) => ({ out: (ctx.config as { value: unknown }).value }),
});

export const input = defineOp({
  type: "core.input",
  title: "core.input",
  description: "Read a run-scoped input/parameter by name (with optional default).",
  inputs: {},
  outputs: { out: value(z.unknown()) },
  config: z.object({ name: z.string(), default: z.unknown().optional() }),
  execute: (ctx) => {
    const { name, default: dflt } = ctx.config as { name: string; default?: unknown };
    const v = ctx.params[name];
    return { out: v === undefined ? dflt : v };
  },
});

export const constOps: OpDefinition[] = [
  constString,
  constNumber,
  constBoolean,
  constNull,
  constObject,
  constArray,
  constJson,
  input,
];
