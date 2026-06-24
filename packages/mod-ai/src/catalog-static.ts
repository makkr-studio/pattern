/**
 * @pattern-js/mod-ai — a static model catalog.
 *
 * The offline fallback that keeps the editor + settings useful with no network
 * and no gateway. The Vercel AI Gateway's /v1/models endpoint is the live,
 * authoritative source (see catalog.ts); this is the curated baseline for the
 * native direct providers. Ids/flags are a best-effort snapshot — refresh from
 * the gateway for the current truth.
 */

import type { ModelCapability } from "./types.js";

const lang = { tools: true, structuredOutput: true, imageInput: true } as const;

export const STATIC_CATALOG: ModelCapability[] = [
  // ── Anthropic (direct) ──
  { id: "claude-opus-4-8", provider: "anthropic", routing: "direct", displayName: "Claude Opus 4.8", modalities: ["language"], capabilities: { ...lang, reasoning: true } },
  { id: "claude-sonnet-4-6", provider: "anthropic", routing: "direct", displayName: "Claude Sonnet 4.6", modalities: ["language"], capabilities: { ...lang, reasoning: true } },
  { id: "claude-haiku-4-5", provider: "anthropic", routing: "direct", displayName: "Claude Haiku 4.5", modalities: ["language"], capabilities: lang },

  // ── OpenAI (direct) ──
  { id: "gpt-5", provider: "openai", routing: "direct", displayName: "GPT-5", modalities: ["language"], capabilities: { ...lang, reasoning: true } },
  { id: "gpt-5-mini", provider: "openai", routing: "direct", displayName: "GPT-5 mini", modalities: ["language"], capabilities: lang },
  { id: "text-embedding-3-small", provider: "openai", routing: "direct", displayName: "Embedding 3 small", modalities: ["embedding"], capabilities: {} },
  { id: "text-embedding-3-large", provider: "openai", routing: "direct", displayName: "Embedding 3 large", modalities: ["embedding"], capabilities: {} },
  { id: "gpt-image-1", provider: "openai", routing: "direct", displayName: "GPT Image 1", modalities: ["image"], capabilities: {} },
  { id: "gpt-4o-mini-tts", provider: "openai", routing: "direct", displayName: "GPT-4o mini TTS", modalities: ["speech"], capabilities: {} },
  { id: "whisper-1", provider: "openai", routing: "direct", displayName: "Whisper", modalities: ["transcription"], capabilities: {} },
  { id: "gpt-4o-transcribe", provider: "openai", routing: "direct", displayName: "GPT-4o Transcribe", modalities: ["transcription"], capabilities: {} },

  // ── Google (direct) ──
  { id: "gemini-2.5-pro", provider: "google", routing: "direct", displayName: "Gemini 2.5 Pro", modalities: ["language"], capabilities: { ...lang, reasoning: true } },
  { id: "gemini-2.5-flash", provider: "google", routing: "direct", displayName: "Gemini 2.5 Flash", modalities: ["language"], capabilities: lang },
  { id: "gemini-embedding-001", provider: "google", routing: "direct", displayName: "Gemini Embedding", modalities: ["embedding"], capabilities: {} },

  // ── Mistral / Groq (direct) ──
  { id: "mistral-large-latest", provider: "mistral", routing: "direct", displayName: "Mistral Large", modalities: ["language"], capabilities: { tools: true, structuredOutput: true } },
  { id: "llama-3.3-70b-versatile", provider: "groq", routing: "direct", displayName: "Llama 3.3 70B (Groq)", modalities: ["language"], capabilities: { tools: true, structuredOutput: true } },

  // ── Video (gateway-first) ──
  { id: "google/veo-3.1-generate-001", provider: "google", routing: "gateway", displayName: "Veo 3.1", modalities: ["video"], capabilities: {} },
  { id: "bytedance/seedance-v1.5-pro", provider: "bytedance", routing: "gateway", displayName: "Seedance 1.5 Pro", modalities: ["video"], capabilities: {} },
];
