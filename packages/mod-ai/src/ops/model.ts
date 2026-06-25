/** @pattern-js/mod-ai — ai.model / ai.alias: build a ModelRef value (pure, like agents.agent). */

import { value, z, type OpDefinition } from "@pattern-js/core";
import { modelRefSchema, type ModelRef } from "@pattern-js/mod-agents";
import { AI_CONFIG_SERVICE } from "../well-known.js";
import type { AiConfigService } from "../config.js";
import { maybe } from "./shared.js";

export const modelOp: OpDefinition = {
  type: "ai.model",
  title: "ai.model",
  description:
    "Build a model reference (a value) to wire into any ai.* op or agents.agent. Define it inline " +
    '(routing "gateway" or "direct" + provider + key), or set `connection` to draw provider/routing/keys ' +
    "from a configured Connection (the only way to use structured-credential providers like Azure/Bedrock/Vertex inline).",
  config: z.object({
    routing: z.enum(["direct", "gateway"]).default("gateway"),
    modality: z.enum(["language", "embedding", "image", "speech", "transcription", "video"]).default("language"),
    /** direct: provider id ("openai"); gateway: the provider half of "provider/model". Omit when using `connection`. */
    provider: z.string().optional(),
    /** direct: bare id ("gpt-5"); gateway: the full "provider/model" id. */
    modelId: z.string().min(1),
    /** Vault secret NAME for the key (defaults per routing/provider). */
    credential: z.string().optional(),
    /** A configured Connection id — supplies provider/routing/keys (incl. structured creds). */
    connection: z.string().optional(),
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
      provider?: string;
      modelId: string;
      credential?: string;
      connection?: string;
    };
    const [credential, providerOptions] = await Promise.all([
      maybe<string>(ctx, "credential"),
      maybe<Record<string, unknown>>(ctx, "providerOptions"),
    ]);
    const model: ModelRef = modelRefSchema.parse({
      kind: "model",
      routing: cfg.routing,
      modality: cfg.modality,
      provider: cfg.provider ?? "",
      modelId: cfg.modelId,
      credential: credential ?? cfg.credential,
      connection: cfg.connection,
      providerOptions,
    });
    return { model };
  },
};

export const aliasOp: OpDefinition = {
  type: "ai.alias",
  title: "ai.alias",
  description:
    "Resolve a named model alias (configured in admin → Settings → AI Providers) to a model reference. " +
    'Re-pointing the alias in Settings instantly re-targets every workflow using it. Defaults to "default".',
  config: z.object({ alias: z.string().min(1).default("default") }),
  configInputs: { alias: value(z.string()) },
  inputs: {},
  outputs: { model: value(modelRefSchema) },
  execute: async (ctx) => {
    const alias = (await maybe<string>(ctx, "alias")) ?? (ctx.config as { alias: string }).alias;
    const config = ctx.services[AI_CONFIG_SERVICE] as AiConfigService | undefined;
    const model = config?.resolveAlias(alias);
    if (!model) {
      throw new Error(
        `ai.alias: no alias "${alias}" is configured (or its connection is missing) — set it in admin → Settings → AI Providers.`,
      );
    }
    return { model };
  },
};
