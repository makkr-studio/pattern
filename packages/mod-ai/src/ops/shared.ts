/** @pattern-js/mod-ai — shared op helpers. */

import type { OpContext } from "@pattern-js/core";
import type { NeutralMessage, Usage } from "@pattern-js/mod-agents";
import { modelRefSchema } from "@pattern-js/mod-agents";
import type { AiProviderService } from "../provider.js";
import { AI_PROVIDER_SERVICE, blobStore } from "../well-known.js";
import { toModelMessages } from "../messages.js";
import type { MediaRef } from "../types.js";
import type { LanguageModel, ModelMessage } from "../sdk.js";

export async function maybe<T>(ctx: OpContext, port: string): Promise<T | undefined> {
  return ctx.input.has(port) ? ((await ctx.input.value(port)) as T) : undefined;
}

export function providerService(ctx: OpContext): AiProviderService {
  const svc = ctx.services[AI_PROVIDER_SERVICE] as AiProviderService | undefined;
  if (!svc) throw new Error("mod-ai: provider service missing — install @pattern-js/mod-ai.");
  return svc;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapUsage(u: any): Usage | undefined {
  if (!u) return undefined;
  return { inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens };
}

/** Resolve the bytes behind a MediaRef (for transcription / image-to-image input). */
export async function mediaBytes(ctx: OpContext, ref: MediaRef): Promise<Uint8Array> {
  const hit = await blobStore(ctx).blobs.get(ref.blobId);
  if (!hit) throw new Error(`mod-ai: no blob "${ref.blobId}".`);
  return new Uint8Array(await new Response(hit.stream).arrayBuffer());
}

/**
 * The ModelRef's `providerOptions` (the AI SDK shape, keyed by provider id:
 * `{ openai: { reasoningEffort: "low" } }`), merged under per-call extras, as
 * a spreadable `{ providerOptions }` (empty when there are none).
 */
export function callOptions(
  ref: { providerOptions?: Record<string, unknown> } | undefined,
  extra?: Record<string, unknown>,
): { providerOptions?: any } {
  const base = ref?.providerOptions ?? {};
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(extra ?? {})) {
    const prev = merged[k];
    merged[k] =
      prev && typeof prev === "object" && v && typeof v === "object" ? { ...(prev as object), ...(v as object) } : v;
  }
  return Object.keys(merged).length ? { providerOptions: merged } : {};
}

/** The providerOptions key for a ModelRef: the provider id ("openai"), or the gateway id's provider half. */
export function providerKey(ref: { routing: string; provider: string; modelId: string }): string {
  return ref.routing === "gateway" ? ref.modelId.split("/")[0] || "gateway" : ref.provider;
}

/** Build the (model, system, messages) trio every text-ish op needs. */
export async function textInput(ctx: OpContext): Promise<{
  model: LanguageModel;
  system: string | undefined;
  messages: ModelMessage[];
  /** The ModelRef's provider options, ready to spread into the SDK call. */
  options: { providerOptions?: any };
}> {
  const [modelRef, prompt, messagesIn, system] = await Promise.all([
    ctx.input.value("model"),
    maybe<string>(ctx, "prompt"),
    maybe<NeutralMessage[]>(ctx, "messages"),
    maybe<string>(ctx, "system"),
  ]);
  const ref = modelRefSchema.parse(modelRef);
  const model = await providerService(ctx).languageModel(ref, ctx);
  const neutral: NeutralMessage[] = messagesIn ?? (typeof prompt === "string" ? [{ role: "user", content: prompt }] : []);
  return { model, system, messages: await toModelMessages(neutral, ctx), options: callOptions(ref) };
}
