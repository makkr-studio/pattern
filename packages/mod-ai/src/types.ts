/**
 * @pattern-js/mod-ai — the value types every op speaks.
 *
 * ModelRef lives in mod-agents (the neutral layer); we re-export it so workflow
 * authors import models from one place. MediaRef is mod-ai's own: a pointer to
 * bytes in mod-store's blob store, so image/audio/video never travel as base64
 * on a port.
 */

import { z } from "@pattern-js/core";

export {
  modelRefSchema,
  usageSchema,
  type ModelRef,
  type Usage,
  type NeutralMessage,
} from "@pattern-js/mod-agents";

const modalityEnum = z.enum(["language", "embedding", "image", "speech", "transcription", "video"]);

/**
 * A named provider **connection**: how to reach a provider and authenticate.
 * Auth material is never stored here — every `secrets` value is the NAME of a
 * vault secret (chosen explicitly in the UI). `options` holds non-secret
 * structured fields (Azure resourceName/apiVersion, Bedrock region, Vertex
 * project/location, …). One connection backs many aliases.
 */
export const connectionSchema = z.object({
  /** Stable id referenced by aliases / ModelRef.connection (e.g. "openai-prod"). */
  id: z.string(),
  /** Human label for the UI; defaults to the id. */
  label: z.string().optional(),
  /** Provider id ("openai", "anthropic", "azure", "amazon-bedrock", "google-vertex", …). */
  provider: z.string(),
  routing: z.enum(["direct", "gateway"]).default("direct"),
  /** Auth field → vault secret NAME. e.g. { apiKey: "MY_OPENAI" } or { accessKeyId, secretAccessKey }. */
  secrets: z.record(z.string(), z.string()).default({}),
  /** Non-secret structured config. e.g. { resourceName, apiVersion } / { region } / { project, location }. */
  options: z.record(z.string(), z.string()).default({}),
});
export type Connection = z.infer<typeof connectionSchema>;

/**
 * A named **alias** — "default", "mini", "vision", … — pointing a memorable
 * name at a connection + model id. `ai.alias` resolves one to a ModelRef at run
 * time, so re-pointing an alias in Settings instantly re-targets every workflow
 * using it. Agents/chat fall back to the "default" alias when no model is wired.
 */
export const aliasSchema = z.object({
  name: z.string(),
  /** Connection id this alias draws provider/routing/keys from. */
  connection: z.string(),
  /** Model id within that provider (direct: bare; gateway: "provider/model"). */
  modelId: z.string(),
  modality: modalityEnum.default("language"),
});
export type Alias = z.infer<typeof aliasSchema>;

/** A pointer to generated/consumed media bytes living in mod-store's blob store. */
export const mediaRefSchema = z.object({
  blobId: z.string(),
  mime: z.string(),
  kind: z.enum(["image", "audio", "video"]).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationMs: z.number().optional(),
});
export type MediaRef = z.infer<typeof mediaRefSchema>;

/** A thin progress channel for long-running (image/video) generations. */
export const genProgressSchema = z.object({
  phase: z.enum(["start", "poll", "done"]),
  index: z.number().optional(),
  message: z.string().optional(),
});
export type GenProgress = z.infer<typeof genProgressSchema>;

/** A transcript segment from speech-to-text. */
export const segmentSchema = z.object({
  text: z.string(),
  startSecond: z.number().optional(),
  endSecond: z.number().optional(),
});

/** What a provider+model can do — drives editor validation + the settings matrix. */
export const modelCapabilitySchema = z.object({
  /** "gpt-5" (direct) or "openai/gpt-5" (gateway). */
  id: z.string(),
  provider: z.string(),
  routing: z.enum(["direct", "gateway"]),
  displayName: z.string().optional(),
  modalities: z.array(z.enum(["language", "embedding", "image", "speech", "transcription", "video"])),
  capabilities: z
    .object({
      tools: z.boolean(),
      structuredOutput: z.boolean(),
      imageInput: z.boolean(),
      reasoning: z.boolean(),
    })
    .partial(),
  contextWindow: z.number().optional(),
  maxOutput: z.number().optional(),
});
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;
export type Modality = ModelCapability["modalities"][number];
