/**
 * §12 — Constants / sources.
 *
 * Each emits a configured literal (or a run-scoped parameter) on its `out` port.
 * Sources have no inputs, so they run immediately at the start of a run.
 */

import { defineOp, value, z } from "./helpers.js";
import { castEnvValue, isEnvUnset, EnvConfigError } from "../env-config.js";
import type { OpDefinition } from "../types.js";

const literal = (
  type: string,
  schema: z.ZodType,
  description: string,
  configKey = "value",
): OpDefinition =>
  defineOp({
    type,
    title: type,
    description,
    inputs: {},
    outputs: { out: value(schema) },
    config: z.object({ [configKey]: schema }),
    execute: (ctx) => ({ out: (ctx.config as Record<string, unknown>)[configKey] }),
  });

export const constString = literal(
  "core.const.string",
  z.string(),
  "Emits a constant string from `config.value`. Output `{ out }`.",
);
export const constNumber = literal(
  "core.const.number",
  z.number(),
  "Emits a constant number from `config.value`. Output `{ out }`.",
);
export const constBoolean = literal(
  "core.const.boolean",
  z.boolean(),
  "Emits a constant boolean from `config.value`. Output `{ out }`.",
);

export const constNull = defineOp({
  type: "core.const.null",
  effects: "pure",
  title: "core.const.null",
  description: "Emits a constant `null`. Output `{ out }`.",
  inputs: {},
  outputs: { out: value(z.null()) },
  execute: () => ({ out: null }),
});

export const constObject = defineOp({
  type: "core.const.object",
  effects: "pure",
  title: "core.const.object",
  description: "Emits a constant object from `config.value`. Output `{ out }`.",
  inputs: {},
  outputs: { out: value(z.record(z.string(), z.unknown())) },
  config: z.object({ value: z.record(z.string(), z.unknown()) }),
  execute: (ctx) => ({ out: (ctx.config as { value: unknown }).value }),
});

export const constArray = defineOp({
  type: "core.const.array",
  effects: "pure",
  title: "core.const.array",
  description: "Emits a constant array from `config.value`. Output `{ out }`.",
  inputs: {},
  outputs: { out: value(z.array(z.unknown())) },
  config: z.object({ value: z.array(z.unknown()) }),
  execute: (ctx) => ({ out: (ctx.config as { value: unknown }).value }),
});

export const constJson = defineOp({
  type: "core.const.json",
  effects: "pure",
  title: "core.const.json",
  description: "Arbitrary JSON literal, optionally validated against a declared schema at author time.",
  inputs: {},
  outputs: { out: value(z.unknown()) },
  config: z.object({ value: z.unknown() }),
  execute: (ctx) => ({ out: (ctx.config as { value: unknown }).value }),
});

export const input = defineOp({
  type: "core.input",
  effects: "pure",
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

export const env = defineOp({
  type: "core.env",
  effects: "pure",
  title: "core.env",
  description:
    "Read an environment variable from ctx.env, with type casting and an optional default. " +
    "The graph-level counterpart of the `$env` config sugar; wire it into a boundary's config port.",
  inputs: {},
  outputs: { out: value(z.unknown()) },
  config: z.object({
    name: z.string(),
    type: z.enum(["string", "number", "integer", "boolean", "json"]).default("string"),
    default: z.unknown().optional(),
  }),
  execute: (ctx) => {
    const { name, type, default: dflt } = ctx.config as {
      name: string;
      type: "string" | "number" | "integer" | "boolean" | "json";
      default?: unknown;
    };
    const raw = ctx.env[name];
    if (isEnvUnset(raw)) {
      if (dflt !== undefined) return { out: dflt };
      throw new EnvConfigError(`missing required env var "${name}" (add a "default" to make it optional)`);
    }
    return { out: castEnvValue(raw as string, type, name) };
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
  env,
];
