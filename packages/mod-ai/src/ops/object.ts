/** @pattern-js/mod-ai — structured object generation ops. */

import { iterableToStream, required, stream, value, z, type OpDefinition } from "@pattern-js/core";
import { modelRefSchema, neutralMessageSchema, usageSchema } from "@pattern-js/mod-agents";
import { generateObject, jsonSchema, streamObject } from "../sdk.js";
import { mapUsage, textInput } from "./shared.js";

const jsonSchemaPort = z.record(z.string(), z.unknown());
const objectInputs = {
  model: required(modelRefSchema),
  prompt: value(z.string()),
  messages: value(z.array(neutralMessageSchema)),
  system: value(z.string()),
  schema: required(jsonSchemaPort),
};

export const objectGenerate: OpDefinition = {
  type: "ai.object.generate",
  title: "ai.object.generate",
  description: "Generate a structured object matching a JSON Schema. Wire a model from ai.model and a schema (JSON Schema).",
  config: z.object({}),
  inputs: objectInputs,
  outputs: { object: value(), usage: value(usageSchema) },
  execute: async (ctx) => {
    const { model, system, messages } = await textInput(ctx);
    const schema = await ctx.input.value<Record<string, unknown>>("schema");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await generateObject({ model, system, messages, schema: jsonSchema(schema as any), abortSignal: ctx.signal });
    return { object: r.object, usage: mapUsage(r.usage) };
  },
};

export const objectStream: OpDefinition = {
  type: "ai.object.stream",
  title: "ai.object.stream",
  description: "Stream a structured object: partials flow as they complete; the final object settles.",
  config: z.object({}),
  inputs: objectInputs,
  outputs: { partialStream: stream(), object: value(), usage: value(usageSchema) },
  execute: async (ctx) => {
    const { model, system, messages } = await textInput(ctx);
    const schema = await ctx.input.value<Record<string, unknown>>("schema");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = streamObject({ model, system, messages, schema: jsonSchema(schema as any), abortSignal: ctx.signal });
    return {
      partialStream: iterableToStream(result.partialObjectStream),
      object: result.object,
      usage: result.usage.then(mapUsage),
    };
  },
};

export const objectOps: OpDefinition[] = [objectGenerate, objectStream];
