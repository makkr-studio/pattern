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
