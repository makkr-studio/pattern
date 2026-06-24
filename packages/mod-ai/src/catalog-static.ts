/**
 * @pattern-js/mod-ai — a static model catalog.
 *
 * The offline baseline that keeps the editor + settings useful with no network
 * and no gateway. The Vercel AI Gateway's /v1/models endpoint is the live,
 * authoritative source (see catalog.ts / the ai.models.list op merges it when a
 * gateway key is present); this is the curated snapshot for the native DIRECT
 * providers (openai, anthropic, google, mistral, groq — the ones with an
 * @ai-sdk factory), plus a few popular gateway-only providers so the breadth is
 * visible offline. Ids/flags are a best-effort snapshot — the live gateway list
 * is the current truth.
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
    { id: "gpt-5.1", provider: "openai", displayName: "GPT-5.1", modalities: ["language"], capabilities: reason },
    { id: "gpt-5", provider: "openai", displayName: "GPT-5", modalities: ["language"], capabilities: reason },
    { id: "gpt-5-mini", provider: "openai", displayName: "GPT-5 mini", modalities: ["language"], capabilities: reason },
    { id: "gpt-5-nano", provider: "openai", displayName: "GPT-5 nano", modalities: ["language"], capabilities: multi },
    { id: "gpt-4.1", provider: "openai", displayName: "GPT-4.1", modalities: ["language"], capabilities: multi },
    { id: "gpt-4.1-mini", provider: "openai", displayName: "GPT-4.1 mini", modalities: ["language"], capabilities: multi },
    { id: "gpt-4.1-nano", provider: "openai", displayName: "GPT-4.1 nano", modalities: ["language"], capabilities: multi },
    { id: "gpt-4o", provider: "openai", displayName: "GPT-4o", modalities: ["language"], capabilities: multi },
    { id: "gpt-4o-mini", provider: "openai", displayName: "GPT-4o mini", modalities: ["language"], capabilities: multi },
    { id: "o3", provider: "openai", displayName: "o3", modalities: ["language"], capabilities: reason },
    { id: "o4-mini", provider: "openai", displayName: "o4-mini", modalities: ["language"], capabilities: reason },
    { id: "text-embedding-3-large", provider: "openai", displayName: "Embedding 3 large", modalities: ["embedding"], capabilities: none },
    { id: "text-embedding-3-small", provider: "openai", displayName: "Embedding 3 small", modalities: ["embedding"], capabilities: none },
    { id: "gpt-image-1", provider: "openai", displayName: "GPT Image 1", modalities: ["image"], capabilities: none },
    { id: "dall-e-3", provider: "openai", displayName: "DALL·E 3", modalities: ["image"], capabilities: none },
    { id: "gpt-4o-mini-tts", provider: "openai", displayName: "GPT-4o mini TTS", modalities: ["speech"], capabilities: none },
    { id: "tts-1", provider: "openai", displayName: "TTS 1", modalities: ["speech"], capabilities: none },
    { id: "tts-1-hd", provider: "openai", displayName: "TTS 1 HD", modalities: ["speech"], capabilities: none },
    { id: "gpt-4o-transcribe", provider: "openai", displayName: "GPT-4o Transcribe", modalities: ["transcription"], capabilities: none },
    { id: "gpt-4o-mini-transcribe", provider: "openai", displayName: "GPT-4o mini Transcribe", modalities: ["transcription"], capabilities: none },
    { id: "whisper-1", provider: "openai", displayName: "Whisper", modalities: ["transcription"], capabilities: none },
  ]),

  // ───────────────────────── Anthropic (direct) ──────────────────────────
  ...direct([
    { id: "claude-opus-4-8", provider: "anthropic", displayName: "Claude Opus 4.8", modalities: ["language"], capabilities: reason },
    { id: "claude-sonnet-4-6", provider: "anthropic", displayName: "Claude Sonnet 4.6", modalities: ["language"], capabilities: reason },
    { id: "claude-haiku-4-5", provider: "anthropic", displayName: "Claude Haiku 4.5", modalities: ["language"], capabilities: multi },
    { id: "claude-fable-5", provider: "anthropic", displayName: "Claude Fable 5", modalities: ["language"], capabilities: reason },
    { id: "claude-opus-4-1", provider: "anthropic", displayName: "Claude Opus 4.1", modalities: ["language"], capabilities: reason },
    { id: "claude-sonnet-4-5", provider: "anthropic", displayName: "Claude Sonnet 4.5", modalities: ["language"], capabilities: reason },
    { id: "claude-3-7-sonnet-latest", provider: "anthropic", displayName: "Claude 3.7 Sonnet", modalities: ["language"], capabilities: reason },
    { id: "claude-3-5-haiku-latest", provider: "anthropic", displayName: "Claude 3.5 Haiku", modalities: ["language"], capabilities: multi },
  ]),

  // ────────────────────────── Google (direct) ────────────────────────────
  ...direct([
    { id: "gemini-2.5-pro", provider: "google", displayName: "Gemini 2.5 Pro", modalities: ["language"], capabilities: reason },
    { id: "gemini-2.5-flash", provider: "google", displayName: "Gemini 2.5 Flash", modalities: ["language"], capabilities: reason },
    { id: "gemini-2.5-flash-lite", provider: "google", displayName: "Gemini 2.5 Flash-Lite", modalities: ["language"], capabilities: multi },
    { id: "gemini-2.0-flash", provider: "google", displayName: "Gemini 2.0 Flash", modalities: ["language"], capabilities: multi },
    { id: "gemini-2.0-flash-lite", provider: "google", displayName: "Gemini 2.0 Flash-Lite", modalities: ["language"], capabilities: multi },
    { id: "gemini-embedding-001", provider: "google", displayName: "Gemini Embedding", modalities: ["embedding"], capabilities: none },
    { id: "text-embedding-004", provider: "google", displayName: "Text Embedding 004", modalities: ["embedding"], capabilities: none },
    { id: "imagen-4.0-generate-001", provider: "google", displayName: "Imagen 4", modalities: ["image"], capabilities: none },
    { id: "imagen-3.0-generate-002", provider: "google", displayName: "Imagen 3", modalities: ["image"], capabilities: none },
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
    { id: "meta-llama/llama-4-scout-17b-16e-instruct", provider: "groq", displayName: "Llama 4 Scout", modalities: ["language"], capabilities: multi },
    { id: "openai/gpt-oss-120b", provider: "groq", displayName: "GPT-OSS 120B", modalities: ["language"], capabilities: reason },
    { id: "moonshotai/kimi-k2-instruct", provider: "groq", displayName: "Kimi K2", modalities: ["language"], capabilities: textOnly },
    { id: "deepseek-r1-distill-llama-70b", provider: "groq", displayName: "DeepSeek R1 Distill 70B", modalities: ["language"], capabilities: reason },
    { id: "gemma2-9b-it", provider: "groq", displayName: "Gemma 2 9B", modalities: ["language"], capabilities: textOnly },
    { id: "whisper-large-v3", provider: "groq", displayName: "Whisper Large v3", modalities: ["transcription"], capabilities: none },
    { id: "whisper-large-v3-turbo", provider: "groq", displayName: "Whisper Large v3 Turbo", modalities: ["transcription"], capabilities: none },
  ]),

  // ───────── Popular gateway-only providers ("provider/model" ids) ─────────
  ...gateway([
    { id: "xai/grok-4", provider: "xai", displayName: "Grok 4", modalities: ["language"], capabilities: reason },
    { id: "xai/grok-3", provider: "xai", displayName: "Grok 3", modalities: ["language"], capabilities: multi },
    { id: "xai/grok-3-mini", provider: "xai", displayName: "Grok 3 mini", modalities: ["language"], capabilities: reason },
    { id: "deepseek/deepseek-reasoner", provider: "deepseek", displayName: "DeepSeek Reasoner (R1)", modalities: ["language"], capabilities: reason },
    { id: "deepseek/deepseek-chat", provider: "deepseek", displayName: "DeepSeek Chat (V3)", modalities: ["language"], capabilities: textOnly },
    { id: "perplexity/sonar", provider: "perplexity", displayName: "Perplexity Sonar", modalities: ["language"], capabilities: textOnly },
    { id: "amazon/nova-pro", provider: "amazon", displayName: "Amazon Nova Pro", modalities: ["language"], capabilities: multi },
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
