/**
 * §12 — Schema ops.
 *
 * Schemas are *values* in Pattern: `core.schema.define` emits a JSON Schema
 * object that flows along value edges — most usefully into a boundary's
 * registration-time config ports (`boundary.http.request`'s `body`/`query`,
 * `boundary.ws.message`'s `message`), where the host compiles it and validates
 * inbound data. `core.schema.validate` applies one mid-graph at runtime.
 *
 * The wire format is JSON Schema (serializable, host-compilable via
 * `jsonSchemaToZod`); authoring UIs may present it as a visual builder.
 */

import { z } from "zod";
import { jsonSchemaToZod } from "../json-schema.js";
import { required, value } from "./helpers.js";
import type { OpDefinition } from "../types.js";

const jsonSchema = z.record(z.string(), z.unknown());

/** Declare a reusable schema; its output feeds config ports or validators. */
export const schemaDefine: OpDefinition = {
  type: "core.schema.define",
  effects: "pure",
  title: "core.schema.define",
  description:
    "Defines a schema (JSON Schema wire format) and emits it as a value. Wire `schema` into a " +
    "trigger's config port (http.request `body`/`query`, ws.message `message`) to validate inbound " +
    "data, or into `core.schema.validate` to check values mid-graph.",
  inputs: {},
  outputs: { schema: value(jsonSchema) },
  config: z.object({
    /** The schema, in JSON Schema form (the admin offers a visual builder). */
    schema: jsonSchema.default({ type: "object", properties: {} }),
  }),
  execute: (ctx) => ({ schema: (ctx.config as { schema: Record<string, unknown> }).schema }),
};

/** Validate a value against a schema (wired or configured) at runtime. */
export const schemaValidate: OpDefinition = {
  type: "core.schema.validate",
  effects: "pure",
  title: "core.schema.validate",
  description:
    "Validates `value` against a schema (the `schema` input, else config.schema). Outputs " +
    "{ valid, value (parsed/coerced), errors }. Branch on `valid` with core.flow.branch.",
  inputs: {
    value: required(),
    schema: value(jsonSchema),
  },
  outputs: {
    valid: value(z.boolean()),
    value: value(),
    errors: value(z.array(z.object({ path: z.string(), message: z.string() }))),
  },
  config: z.object({ schema: jsonSchema.optional() }),
  execute: async (ctx) => {
    const input = await ctx.input.value("value");
    const schema = ctx.input.has("schema")
      ? await ctx.input.value<Record<string, unknown>>("schema")
      : (ctx.config as { schema?: Record<string, unknown> }).schema;
    if (!schema) return { valid: true, value: input, errors: [] };
    const compiled = jsonSchemaToZod(schema as never);
    const res = compiled.safeParse(input);
    return res.success
      ? { valid: true, value: res.data, errors: [] }
      : {
          valid: false,
          value: input,
          errors: res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        };
  },
};

export const schemaOps: OpDefinition[] = [schemaDefine, schemaValidate];
