/**
 * @pattern-js/mod-ai — static model SUGGESTIONS.
 *
 * Model ids are free text (you type "gpt-5" or pick a provider/model), so this
 * is not a gate — it is a curated set of popular ids per provider that keeps the
 * editor + settings useful offline with no network and no gateway. The Vercel AI
 * Gateway's /v1/models endpoint is the live, authoritative source (catalog.ts /
 * the ai.models.list op merges it when a gateway key is present). Ids/flags are
 * a best-effort snapshot; the live gateway list is the current truth.
 */

import type { ModelCapability } from "./types.js";

// Capability presets.
const reason = { tools: true, structuredOutput: true, imageInput: true, reasoning: true } as const; // multimodal + reasoning
const multi = { tools: true, structuredOutput: true, imageInput: true } as const; // multimodal LLM
const textOnly = { tools: true, structuredOutput: true } as const; // text-only LLM
const none = {} as const; // embeddings / media models

type Row = Omit<ModelCapability, "routing">;
const direct = (rows: Row[]): ModelCapability[] => rows.map((r) => ({ ...r, routing: "direct" }));
const gateway = (rows: Row[]): ModelCapability[] => rows.map((r) => ({ ...r, routing: "gateway" }));

export const STATIC_CATALOG: ModelCapability[] = [
  // ─────────────────────────── OpenAI (direct) ───────────────────────────
  ...direct([
    { id: "gpt-5.6-sol", provider: "openai", displayName: "GPT-5.6 Sol", modalities: ["language"], capabilities: reason },
    { id: "gpt-5.6-terra", provider: "openai", displayName: "GPT-5.6 Terra", modalities: ["language"], capabilities: reason },
    { id: "gpt-5.6-luna", provider: "openai", displayName: "GPT-5.6 Luna", modalities: ["language"], capabilities: reason },
    { id: "gpt-5.1", provider: "openai", displayName: "GPT-5.1", modalities: ["language"], capabilities: reason },
    { id: "gpt-5", provider: "openai", displayName: "GPT-5", modalities: ["language"], capabilities: reason },
    { id: "gpt-5-mini", provider: "openai", displayName: "GPT-5 mini", modalities: ["language"], capabilities: reason },
    { id: "text-embedding-3-large", provider: "openai", displayName: "Embedding 3 large", modalities: ["embedding"], capabilities: none },
    { id: "text-embedding-3-small", provider: "openai", displayName: "Embedding 3 small", modalities: ["embedding"], capabilities: none },
    { id: "gpt-image-2", provider: "openai", displayName: "GPT Image 2", modalities: ["image"], capabilities: none },
    { id: "gpt-image-1", provider: "openai", displayName: "GPT Image 1", modalities: ["image"], capabilities: none },
    { id: "gpt-4o-mini-tts", provider: "openai", displayName: "GPT-4o mini TTS", modalities: ["speech"], capabilities: none },
    { id: "gpt-4o-transcribe", provider: "openai", displayName: "GPT-4o Transcribe", modalities: ["transcription"], capabilities: none },
    { id: "gpt-4o-mini-transcribe", provider: "openai", displayName: "GPT-4o mini Transcribe", modalities: ["transcription"], capabilities: none },
    { id: "whisper-1", provider: "openai", displayName: "Whisper", modalities: ["transcription"], capabilities: none },
  ]),

  // ───────────────────────── Anthropic (direct) ──────────────────────────
  ...direct([
    { id: "claude-fable-5", provider: "anthropic", displayName: "Claude Fable 5", modalities: ["language"], capabilities: reason },
    { id: "claude-sonnet-5", provider: "anthropic", displayName: "Claude Sonnet 5", modalities: ["language"], capabilities: reason },
    { id: "claude-opus-4-8", provider: "anthropic", displayName: "Claude Opus 4.8", modalities: ["language"], capabilities: reason },
    { id: "claude-haiku-4-5", provider: "anthropic", displayName: "Claude Haiku 4.5", modalities: ["language"], capabilities: multi },
    { id: "claude-sonnet-4-6", provider: "anthropic", displayName: "Claude Sonnet 4.6", modalities: ["language"], capabilities: reason },
  ]),

  // ────────────────────────── Google (direct) ────────────────────────────
  ...direct([
    { id: "gemini-3.6-flash", provider: "google", displayName: "Gemini 3.6 Flash", modalities: ["language"], capabilities: reason },
    { id: "gemini-3.5-flash", provider: "google", displayName: "Gemini 3.5 Flash", modalities: ["language"], capabilities: reason },
    { id: "gemini-3.5-flash-lite", provider: "google", displayName: "Gemini 3.5 Flash-Lite", modalities: ["language"], capabilities: multi },
    { id: "gemini-3.1-pro-preview", provider: "google", displayName: "Gemini 3.1 Pro (preview)", modalities: ["language"], capabilities: reason },
    { id: "gemini-2.5-pro", provider: "google", displayName: "Gemini 2.5 Pro", modalities: ["language"], capabilities: reason },
    { id: "gemini-2.5-flash", provider: "google", displayName: "Gemini 2.5 Flash", modalities: ["language"], capabilities: reason },
    { id: "gemini-embedding-2", provider: "google", displayName: "Gemini Embedding 2", modalities: ["embedding"], capabilities: none },
    { id: "gemini-embedding-001", provider: "google", displayName: "Gemini Embedding", modalities: ["embedding"], capabilities: none },
    { id: "gemini-3.1-flash-image", provider: "google", displayName: "Nano Banana 2", modalities: ["image"], capabilities: none },
    { id: "gemini-3-pro-image", provider: "google", displayName: "Nano Banana Pro", modalities: ["image"], capabilities: none },
    { id: "gemini-2.5-flash-image", provider: "google", displayName: "Nano Banana", modalities: ["image"], capabilities: none },
    { id: "gemini-3.1-flash-tts-preview", provider: "google", displayName: "Gemini 3.1 Flash TTS (preview)", modalities: ["speech"], capabilities: none },
  ]),

  // ────────────────────────── Mistral (direct) ───────────────────────────
  ...direct([
    { id: "mistral-large-latest", provider: "mistral", displayName: "Mistral Large", modalities: ["language"], capabilities: textOnly },
    { id: "mistral-medium-latest", provider: "mistral", displayName: "Mistral Medium", modalities: ["language"], capabilities: multi },
    { id: "mistral-small-latest", provider: "mistral", displayName: "Mistral Small", modalities: ["language"], capabilities: multi },
    { id: "magistral-medium-latest", provider: "mistral", displayName: "Magistral Medium", modalities: ["language"], capabilities: reason },
    { id: "ministral-8b-latest", provider: "mistral", displayName: "Ministral 8B", modalities: ["language"], capabilities: textOnly },
    { id: "ministral-3b-latest", provider: "mistral", displayName: "Ministral 3B", modalities: ["language"], capabilities: textOnly },
    { id: "pixtral-large-latest", provider: "mistral", displayName: "Pixtral Large", modalities: ["language"], capabilities: multi },
    { id: "codestral-latest", provider: "mistral", displayName: "Codestral", modalities: ["language"], capabilities: textOnly },
    { id: "mistral-embed", provider: "mistral", displayName: "Mistral Embed", modalities: ["embedding"], capabilities: none },
  ]),

  // ─────────────────────────── Groq (direct) ─────────────────────────────
  ...direct([
    { id: "llama-3.3-70b-versatile", provider: "groq", displayName: "Llama 3.3 70B", modalities: ["language"], capabilities: textOnly },
    { id: "llama-3.1-8b-instant", provider: "groq", displayName: "Llama 3.1 8B Instant", modalities: ["language"], capabilities: textOnly },
    { id: "meta-llama/llama-4-maverick-17b-128e-instruct", provider: "groq", displayName: "Llama 4 Maverick", modalities: ["language"], capabilities: multi },
    { id: "openai/gpt-oss-120b", provider: "groq", displayName: "GPT-OSS 120B", modalities: ["language"], capabilities: reason },
    { id: "qwen/qwen3.6-27b", provider: "groq", displayName: "Qwen 3.6 27B", modalities: ["language"], capabilities: reason },
    { id: "moonshotai/kimi-k2-instruct", provider: "groq", displayName: "Kimi K2", modalities: ["language"], capabilities: textOnly },
    { id: "deepseek-r1-distill-llama-70b", provider: "groq", displayName: "DeepSeek R1 Distill 70B", modalities: ["language"], capabilities: reason },
    { id: "gemma2-9b-it", provider: "groq", displayName: "Gemma 2 9B", modalities: ["language"], capabilities: textOnly },
    { id: "whisper-large-v3", provider: "groq", displayName: "Whisper Large v3", modalities: ["transcription"], capabilities: none },
    { id: "whisper-large-v3-turbo", provider: "groq", displayName: "Whisper Large v3 Turbo", modalities: ["transcription"], capabilities: none },
  ]),

  // ────────────────────────── Voyage (direct) ────────────────────────────
  ...direct([
    { id: "voyage-4-large", provider: "voyage", displayName: "Voyage 4 large", modalities: ["embedding"], capabilities: none },
    { id: "voyage-4", provider: "voyage", displayName: "Voyage 4", modalities: ["embedding"], capabilities: none },
    { id: "voyage-4-lite", provider: "voyage", displayName: "Voyage 4 lite", modalities: ["embedding"], capabilities: none },
  ]),

  // ───────── Popular gateway-only providers ("provider/model" ids) ─────────
  ...gateway([
    { id: "xai/grok-4.5", provider: "xai", displayName: "Grok 4.5", modalities: ["language"], capabilities: reason },
    { id: "xai/grok-4", provider: "xai", displayName: "Grok 4", modalities: ["language"], capabilities: reason },
    { id: "deepseek/deepseek-reasoner", provider: "deepseek", displayName: "DeepSeek Reasoner (R1)", modalities: ["language"], capabilities: reason },
    { id: "deepseek/deepseek-chat", provider: "deepseek", displayName: "DeepSeek Chat (V3)", modalities: ["language"], capabilities: textOnly },
    { id: "perplexity/sonar", provider: "perplexity", displayName: "Perplexity Sonar", modalities: ["language"], capabilities: textOnly },
    { id: "amazon/nova-pro", provider: "amazon", displayName: "Amazon Nova Pro", modalities: ["language"], capabilities: multi },
    { id: "cohere/command-a-plus-05-2026", provider: "cohere", displayName: "Cohere Command A+", modalities: ["language"], capabilities: textOnly },
    { id: "cohere/command-a", provider: "cohere", displayName: "Cohere Command A", modalities: ["language"], capabilities: textOnly },
    { id: "cohere/embed-v4.0", provider: "cohere", displayName: "Cohere Embed v4", modalities: ["embedding"], capabilities: none },
  ]),

  // ─────────────────── Video (gateway-first, long-running) ────────────────
  ...gateway([
    { id: "google/veo-3.1-generate-001", provider: "google", displayName: "Veo 3.1", modalities: ["video"], capabilities: none },
    { id: "google/veo-2.0-generate-001", provider: "google", displayName: "Veo 2", modalities: ["video"], capabilities: none },
    { id: "bytedance/seedance-v1.5-pro", provider: "bytedance", displayName: "Seedance 1.5 Pro", modalities: ["video"], capabilities: none },
  ]),
];
