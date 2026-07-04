/**
 * @pattern-js/mod-ai — the value types every op speaks.
 *
 * ModelRef lives in mod-agents (the neutral layer); we re-export it so workflow
 * authors import models from one place. MediaRef is mod-ai's own: a pointer to
 * bytes in mod-store's blob store, so image/audio/video never travel as base64
 * on a port.
 */

import { z, secretRefSchema } from "@pattern-js/core";

export {
  modelRefSchema,
  usageSchema,
  type ModelRef,
  type Usage,
  type NeutralMessage,
} from "@pattern-js/mod-agents";

// Sourced secret references now live in core (hoisted once mod-email and
// mod-vectors joined mod-ai as consumers); re-exported for existing importers.
export { secretRefSchema, type SecretRef } from "@pattern-js/core";

const modalityEnum = z.enum(["language", "embedding", "image", "speech", "transcription", "video"]);

/**
 * A named **alias** — "default", "mini", "vision", … — a fully self-contained
 * model handle: a provider, a model id, the secret(s) it authenticates with
 * (each from the vault or an env var) and any structured options (Azure
 * resourceName, Bedrock region, Vertex project/location, an OpenAI-compatible
 * baseURL, …). Two aliases of the same provider with different credentials are
 * just two records. `ai.alias` resolves one to a ModelRef at run time, so
 * re-pointing an alias in Settings instantly re-targets every workflow using it.
 * Agents/chat fall back to the "default" alias when no model is wired.
 */
export const aliasSchema = z.object({
  name: z.string(),
  /** Provider id from the registry ("openai", "azure", "amazon-bedrock", "gateway", …). */
  provider: z.string(),
  /** Model id within that provider (direct: bare "gpt-5"; gateway: "openai/gpt-5"). */
  modelId: z.string(),
  modality: modalityEnum.default("language"),
  /** Auth field → where its secret comes from. e.g. { apiKey: { source:"env", key:"OPENAI_API_KEY" } }. */
  secrets: z.record(z.string(), secretRefSchema).default({}),
  /** Non-secret structured config. e.g. { resourceName, apiVersion } / { region } / { project, location }. */
  options: z.record(z.string(), z.string()).default({}),
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

/** Raw generated media held in memory — NOT persisted. The generation ops
 *  (ai.image/speech/video.generate) output this; persist it explicitly by wiring
 *  it into `store.blob.put` (which returns a MediaRef). Keeping the save out of the
 *  op means mod-ai never assumes a blob store is present. */
export const mediaSchema = z.object({
  // Widened over the buffer backing so provider SDK bytes (Uint8Array<ArrayBufferLike>) assign cleanly.
  bytes: z.custom<Uint8Array<ArrayBufferLike>>((v) => v instanceof Uint8Array),
  mime: z.string(),
  kind: z.enum(["image", "audio", "video"]),
});
export type Media = z.infer<typeof mediaSchema>;

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
