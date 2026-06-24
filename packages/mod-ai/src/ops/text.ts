/** @pattern-js/mod-ai — text generation ops. */

import { iterableToStream, required, stream, value, z, type OpDefinition } from "@pattern-js/core";
import { modelRefSchema, neutralMessageSchema, usageSchema } from "@pattern-js/mod-agents";
import { generateText, streamText } from "../sdk.js";
import { mapUsage, textInput } from "./shared.js";

const textInputs = {
  model: required(modelRefSchema),
  prompt: value(z.string()),
  messages: value(z.array(neutralMessageSchema)),
  system: value(z.string()),
};
const textConfig = z.object({ maxOutputTokens: z.number().int().positive().optional() });

export const textGenerate: OpDefinition = {
  type: "ai.text.generate",
  title: "ai.text.generate",
  description: "Generate text in one shot. prompt XOR messages, optional system. Wire a model from ai.model.",
  config: textConfig,
  inputs: textInputs,
  outputs: { text: value(z.string()), usage: value(usageSchema), finishReason: value(z.string()) },
  execute: async (ctx) => {
    const { model, system, messages } = await textInput(ctx);
    const cfg = ctx.config as { maxOutputTokens?: number };
    const r = await generateText({ model, system, messages, maxOutputTokens: cfg.maxOutputTokens, abortSignal: ctx.signal });
    return { text: r.text, usage: mapUsage(r.totalUsage), finishReason: r.finishReason };
  },
};

export const textStream: OpDefinition = {
  type: "ai.text.stream",
  title: "ai.text.stream",
  description: "Stream text token-by-token; text/usage settle when done. prompt XOR messages, optional system.",
  config: textConfig,
  inputs: textInputs,
  outputs: {
    textStream: stream(z.string()),
    text: value(z.string()),
    usage: value(usageSchema),
    finishReason: value(z.string()),
  },
  execute: async (ctx) => {
    const { model, system, messages } = await textInput(ctx);
    const cfg = ctx.config as { maxOutputTokens?: number };
    const result = streamText({ model, system, messages, maxOutputTokens: cfg.maxOutputTokens, abortSignal: ctx.signal });
    return {
      textStream: iterableToStream(result.textStream),
      text: result.text,
      usage: result.totalUsage.then(mapUsage),
      finishReason: result.finishReason,
    };
  },
};

export const textOps: OpDefinition[] = [textGenerate, textStream];
