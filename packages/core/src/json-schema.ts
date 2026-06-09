/**
 * Pattern — a small JSON-Schema → Zod compiler.
 *
 * Workflows are data, so a boundary op that wants to validate an inbound body or
 * query declares the shape as JSON Schema *in its config* (not as code). This
 * compiles the common JSON-Schema subset to a Zod schema the engine can use both
 * for request validation (in the host) and for graph-level port typing.
 *
 * Supported: `type` (string/number/integer/boolean/null/object/array), `enum`,
 * `const`, `properties`/`required`/`additionalProperties`, `items`, `nullable`,
 * `format` (email/url/uuid/date-time), and the common numeric/string/array
 * bounds. Anything unknown degrades to `z.unknown()` rather than throwing.
 */

import { z } from "zod";

export type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  nullable?: boolean;
  format?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  [k: string]: unknown;
};

/** Options for compilation. `coerce` uses `z.coerce.*` for primitives (query params). */
export interface JsonSchemaToZodOptions {
  coerce?: boolean;
}

function stringSchema(s: JsonSchema): z.ZodType {
  let str = z.string();
  switch (s.format) {
    case "email":
      str = str.email();
      break;
    case "url":
    case "uri":
      str = str.url();
      break;
    case "uuid":
      str = str.uuid();
      break;
    case "date-time":
      str = str.datetime();
      break;
  }
  if (typeof s.minLength === "number") str = str.min(s.minLength);
  if (typeof s.maxLength === "number") str = str.max(s.maxLength);
  if (typeof s.pattern === "string") str = str.regex(new RegExp(s.pattern));
  return str;
}

function numberSchema(s: JsonSchema, integer: boolean, coerce: boolean): z.ZodType {
  let num = coerce ? z.coerce.number() : z.number();
  if (integer) num = num.int();
  if (typeof s.minimum === "number") num = num.min(s.minimum);
  if (typeof s.maximum === "number") num = num.max(s.maximum);
  return num;
}

function objectSchema(s: JsonSchema, opts: JsonSchemaToZodOptions): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  const required = new Set(s.required ?? []);
  for (const [key, prop] of Object.entries(s.properties ?? {})) {
    const child = jsonSchemaToZod(prop, opts);
    shape[key] = required.has(key) ? child : child.optional();
  }
  let obj = z.object(shape);
  if (s.additionalProperties === false) return obj.strict();
  if (s.additionalProperties && typeof s.additionalProperties === "object") {
    return obj.catchall(jsonSchemaToZod(s.additionalProperties, opts));
  }
  return obj.passthrough();
}

/** Compile a JSON-Schema subset to a Zod schema. Unknown shapes → z.unknown(). */
export function jsonSchemaToZod(
  schema: JsonSchema | undefined | null,
  opts: JsonSchemaToZodOptions = {},
): z.ZodType {
  if (!schema || typeof schema !== "object") return z.unknown();

  if ("const" in schema) return z.literal(schema.const as any);
  if (Array.isArray(schema.enum)) {
    const lits = schema.enum.map((v) => z.literal(v as any));
    const base: z.ZodType = lits.length === 1 ? lits[0]! : z.union(lits as any);
    return schema.nullable ? base.nullable() : base;
  }

  // A union of types — best-effort: take the first non-null, allow null if listed.
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const primary = types.find((t) => t !== "null") ?? types[0];
  const nullable = schema.nullable || types.includes("null");
  const coerce = opts.coerce ?? false;

  let base: z.ZodType;
  switch (primary) {
    case "string":
      base = stringSchema(schema);
      break;
    case "number":
      base = numberSchema(schema, false, coerce);
      break;
    case "integer":
      base = numberSchema(schema, true, coerce);
      break;
    case "boolean":
      base = coerce ? z.coerce.boolean() : z.boolean();
      break;
    case "null":
      base = z.null();
      break;
    case "array": {
      let arr = z.array(jsonSchemaToZod(schema.items, opts));
      if (typeof schema.minItems === "number") arr = arr.min(schema.minItems);
      if (typeof schema.maxItems === "number") arr = arr.max(schema.maxItems);
      base = arr;
      break;
    }
    case "object":
      base = objectSchema(schema, opts);
      break;
    default:
      base = schema.properties ? objectSchema(schema, opts) : z.unknown();
  }

  return nullable ? base.nullable() : base;
}
