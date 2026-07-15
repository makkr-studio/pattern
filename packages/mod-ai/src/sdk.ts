/**
 * @pattern-js/mod-ai — the single AI SDK import surface.
 *
 * EVERY static reference to `ai` lives here. The provider PACKAGES
 * (`@ai-sdk/*`) are never imported statically: mod-ai bundles none of them and
 * lazy-imports each one only when an alias uses it (see registry.ts /
 * provider.ts). The Vercel AI Gateway is the exception — it ships inside `ai`
 * (`createGateway`), so it always works with no extra install. Confining the
 * SDK to one place makes a v6→v7 upgrade a one-file change. Pinned to ai@^6.
 */

export {
  generateText,
  streamText,
  generateObject,
  streamObject,
  embed,
  embedMany,
  generateImage,
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribe,
  experimental_generateVideo as generateVideo,
  tool,
  jsonSchema,
  stepCountIs,
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
