/** @pattern-js/mod-ai — embedding ops. */

import { required, value, z, type OpDefinition } from "@pattern-js/core";
import { modelRefSchema, usageSchema } from "@pattern-js/mod-agents";
import { embed, embedMany } from "../sdk.js";
import { mapUsage, providerService } from "./shared.js";

export const embedOp: OpDefinition = {
  type: "ai.embed",
  title: "ai.embed",
  description: "Embed one string into a vector. Wire an embedding model from ai.model (modality: embedding).",
  config: z.object({}),
  inputs: { model: required(modelRefSchema), value: required(z.string()) },
  outputs: { embedding: value(z.array(z.number())), usage: value(usageSchema) },
  execute: async (ctx) => {
    const [modelRef, val] = await Promise.all([ctx.input.value("model"), ctx.input.value<string>("value")]);
    const model = await providerService(ctx).textEmbeddingModel(modelRefSchema.parse(modelRef), ctx);
    const r = await embed({ model, value: val, abortSignal: ctx.signal });
    return { embedding: r.embedding, usage: mapUsage(r.usage) };
  },
};

export const embedManyOp: OpDefinition = {
  type: "ai.embed.many",
  title: "ai.embed.many",
  description: "Embed many strings into vectors (order-preserving). Wire an embedding model from ai.model.",
  config: z.object({ maxParallelCalls: z.number().int().positive().optional() }),
  inputs: { model: required(modelRefSchema), values: required(z.array(z.string())) },
  outputs: { embeddings: value(z.array(z.array(z.number()))), usage: value(usageSchema) },
  execute: async (ctx) => {
    const [modelRef, values] = await Promise.all([ctx.input.value("model"), ctx.input.value<string[]>("values")]);
    const model = await providerService(ctx).textEmbeddingModel(modelRefSchema.parse(modelRef), ctx);
    const cfg = ctx.config as { maxParallelCalls?: number };
    const r = await embedMany({ model, values, maxParallelCalls: cfg.maxParallelCalls, abortSignal: ctx.signal });
    return { embeddings: r.embeddings, usage: mapUsage(r.usage) };
  },
};

export const embedOps: OpDefinition[] = [embedOp, embedManyOp];
