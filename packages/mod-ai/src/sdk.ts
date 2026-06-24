/**
 * @pattern-js/mod-ai — the single AI SDK import surface.
 *
 * EVERY reference to `ai` / `@ai-sdk/*` lives here and in provider.ts. Confining
 * the SDK to one place makes a v6→v7 upgrade a one-file change and keeps the
 * experimental video name (and any other moving surface) in exactly one spot.
 * Pinned to ai@^6.
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
} from "ai";

export type {
  ModelMessage,
  LanguageModel,
  EmbeddingModel,
  ImageModel,
  SpeechModel,
  TranscriptionModel,
  ToolSet,
} from "ai";

export { createGateway } from "@ai-sdk/gateway";
export { createOpenAI } from "@ai-sdk/openai";
export { createAnthropic } from "@ai-sdk/anthropic";
export { createGoogleGenerativeAI } from "@ai-sdk/google";
export { createMistral } from "@ai-sdk/mistral";
export { createGroq } from "@ai-sdk/groq";
