/** @pattern-js/mod-ai — ai.model: build a ModelRef value (pure, like agents.agent). */

import { value, z, type OpDefinition } from "@pattern-js/core";
import { modelRefSchema, type ModelRef } from "@pattern-js/mod-agents";
import { maybe } from "./shared.js";

export const modelOp: OpDefinition = {
  type: "ai.model",
  title: "ai.model",
  description:
    "Build a model reference (a value) to wire into any ai.* op or agents.agent. Routing is explicit: " +
    '"gateway" (the Vercel AI Gateway: one key, provider/model ids, BYOK) or "direct" (a native provider + its key).',
  config: z.object({
    routing: z.enum(["direct", "gateway"]).default("gateway"),
    modality: z.enum(["language", "embedding", "image", "speech", "transcription", "video"]).default("language"),
    /** direct: provider id ("openai"); gateway: the provider half of "provider/model". */
    provider: z.string().min(1),
    /** direct: bare id ("gpt-5"); gateway: the full "provider/model" id. */
    modelId: z.string().min(1),
    /** Vault secret NAME for the key (defaults per routing/provider). */
    credential: z.string().optional(),
  }),
  configInputs: {
    provider: value(z.string()),
    modelId: value(z.string()),
  },
  inputs: {
    credential: value(z.string()),
    providerOptions: value(z.record(z.string(), z.unknown())),
  },
  outputs: { model: value(modelRefSchema) },
  execute: async (ctx) => {
    const cfg = ctx.config as {
      routing: "direct" | "gateway";
      modality: ModelRef["modality"];
      provider: string;
      modelId: string;
      credential?: string;
    };
    const [credential, providerOptions] = await Promise.all([
      maybe<string>(ctx, "credential"),
      maybe<Record<string, unknown>>(ctx, "providerOptions"),
    ]);
    const model: ModelRef = modelRefSchema.parse({
      kind: "model",
      routing: cfg.routing,
      modality: cfg.modality,
      provider: cfg.provider,
      modelId: cfg.modelId,
      credential: credential ?? cfg.credential,
      providerOptions,
    });
    return { model };
  },
};
