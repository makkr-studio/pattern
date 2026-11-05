/**
 * @pattern-js/mod-ai — the single AI SDK import surface.
 *
 * EVERY static reference to `ai` lives here. The provider PACKAGES
 * (`@ai-sdk/*`) are never imported statically: mod-ai bundles none of them and
 * lazy-imports each one only when an alias uses it (see registry.ts /
 * provider.ts). The Vercel AI Gateway is the exception — it ships inside `ai`
 * (`createGateway`), so it always works with no extra install. Confining the
 * SDK to one place made the v6→v7 upgrade (nearly) a one-file change. Pinned
 * to ai@^7: speech and transcription graduated from `experimental_`, `system`
 * became `instructions` at the call sites, `totalUsage` folded into `usage`,
 * and `stepCountIs` is `isStepCount`. Video is still experimental upstream.
 */

export {
  generateText,
  streamText,
  generateObject,
  streamObject,
  embed,
  embedMany,
  generateImage,
  generateSpeech,
  transcribe,
  experimental_generateVideo as generateVideo,
  tool,
  jsonSchema,
  isStepCount,
  createGateway,
  wrapLanguageModel,
} from "ai";

export type {
  ModelMessage,
  LanguageModel,
  LanguageModelMiddleware,
  EmbeddingModel,
  ImageModel,
  SpeechModel,
  TranscriptionModel,
  ToolSet,
} from "ai";
