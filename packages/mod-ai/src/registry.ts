/**
 * @pattern-js/mod-ai — the provider registry.
 *
 * One descriptor per supported provider: its npm package, the factory to call,
 * the secret + option fields it authenticates with, the modalities it serves,
 * and how to build the SDK provider from resolved credentials. This is the
 * single source of truth the ProviderService (provider.ts) builds from and the
 * settings form renders from.
 *
 * mod-ai bundles NO provider package. `ai` (the only hard dep) carries the
 * Vercel AI Gateway, so the gateway always works; every DIRECT provider is an
 * OPTIONAL peer dependency, lazy-imported only when an alias uses it. Each
 * factory name + option-field shape below was verified against the published
 * packages — getting them wrong fails silently at run time.
 *
 * Package majors differ (they share the `@ai-sdk/provider@3` spec, so all are
 * ai@6-compatible); `create-pattern` carries the matching ranges.
 */

import type { Modality } from "./types.js";
import type {
  EmbeddingModel,
  ImageModel,
  LanguageModel,
  SpeechModel,
  TranscriptionModel,
} from "./sdk.js";

/** A provider exposes the model factories it supports (others are absent — guard before calling). */
export interface ProviderLike {
  languageModel?(id: string): LanguageModel;
  textEmbeddingModel?(id: string): EmbeddingModel;
  imageModel?(id: string): ImageModel;
  speechModel?(id: string): SpeechModel;
  transcriptionModel?(id: string): TranscriptionModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  video?(id: string): any;
}

export type Creds = Record<string, string>;
export type Opts = Record<string, string>;

/** A secret a provider authenticates with (resolved from the vault or an env var). */
export interface SecretField {
  name: string;
  label?: string;
  /** Always needed (single-key providers) vs. one-of several auth styles (AWS). */
  required?: boolean;
}
/** A non-secret structured field (region, resourceName, baseURL, project, …). */
export interface OptionField {
  name: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
}

export interface ProviderSpec {
  id: string;
  label: string;
  /** npm package — install hint + the lazy-import specifier. "" for the gateway (ships with `ai`). */
  pkg: string;
  /** The version range create-pattern installs for this package ("" for the gateway). */
  range: string;
  /** Modalities this provider serves — drives the modality dropdown (free-text modelId stays authoritative). */
  modalities: Modality[];
  secrets: SecretField[];
  options?: OptionField[];
  /**
   * Default secret NAME for INLINE (alias-less `ai.model`) use, resolved env→vault.
   * Absent ⇒ the provider needs structured config, so it must go through an alias.
   */
  inlineSecret?: string;
  /** Build the SDK provider from the lazy module + resolved secret VALUES + structured options. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  make(mod: any, creds: Creds, opts: Opts): ProviderLike;
}

const KEY: SecretField = { name: "apiKey", required: true };
const u = (v: string | undefined): string | undefined => v || undefined;

/** A single-key provider: `createX({ apiKey })`, usable inline via `inlineSecret`. */
function single(
  id: string,
  label: string,
  pkg: string,
  range: string,
  factory: string,
  inlineSecret: string,
  modalities: Modality[],
): ProviderSpec {
  return { id, label, pkg, range, modalities, secrets: [KEY], inlineSecret, make: (m, c) => m[factory]({ apiKey: c.apiKey }) };
}

/**
 * The registry, ordered by how likely a provider is to be picked. The gateway is
 * first and needs no package; every other entry is an optional peer.
 */
export const SPECS: ProviderSpec[] = [
  // ── The gateway (built into `ai`; ProviderService builds it directly) ──
  {
    id: "gateway",
    label: "AI Gateway",
    pkg: "",
    range: "",
    modalities: ["language", "embedding", "image", "speech", "transcription", "video"],
    secrets: [{ name: "apiKey", label: "AI_GATEWAY_API_KEY" }],
    inlineSecret: "AI_GATEWAY_API_KEY",
    make: () => ({}), // unused — handled in ProviderService
  },

  // ── Single-key direct providers ──
  single("xai", "xAI Grok", "@ai-sdk/xai", "^3", "createXai", "XAI_API_KEY", ["language", "image", "video"]),
  single("vercel", "Vercel", "@ai-sdk/vercel", "^2", "createVercel", "VERCEL_API_KEY", ["language", "image"]),
  single("openai", "OpenAI", "@ai-sdk/openai", "^3", "createOpenAI", "OPENAI_API_KEY", ["language", "embedding", "image", "speech", "transcription"]),
  single("anthropic", "Anthropic", "@ai-sdk/anthropic", "^3", "createAnthropic", "ANTHROPIC_API_KEY", ["language"]),
  single("groq", "Groq", "@ai-sdk/groq", "^3", "createGroq", "GROQ_API_KEY", ["language", "transcription"]),
  single("fal", "Fal", "@ai-sdk/fal", "^2", "createFal", "FAL_API_KEY", ["image", "speech", "transcription", "video"]),
  single("deepinfra", "DeepInfra", "@ai-sdk/deepinfra", "^2", "createDeepInfra", "DEEPINFRA_API_KEY", ["language", "embedding", "image"]),
  single("black-forest-labs", "Black Forest Labs", "@ai-sdk/black-forest-labs", "^1", "createBlackForestLabs", "BFL_API_KEY", ["image"]),
  single("google", "Google Generative AI", "@ai-sdk/google", "^3", "createGoogleGenerativeAI", "GOOGLE_GENERATIVE_AI_API_KEY", ["language", "embedding", "image", "video"]),
  single("mistral", "Mistral AI", "@ai-sdk/mistral", "^3", "createMistral", "MISTRAL_API_KEY", ["language", "embedding"]),
  single("togetherai", "Together.ai", "@ai-sdk/togetherai", "^2", "createTogetherAI", "TOGETHER_AI_API_KEY", ["language", "embedding", "image"]),
  single("cohere", "Cohere", "@ai-sdk/cohere", "^3", "createCohere", "COHERE_API_KEY", ["language", "embedding"]),
  single("fireworks", "Fireworks", "@ai-sdk/fireworks", "^2", "createFireworks", "FIREWORKS_API_KEY", ["language", "embedding", "image"]),
  single("voyage", "Voyage AI", "@ai-sdk/voyage", "^1", "createVoyage", "VOYAGE_API_KEY", ["embedding"]),
  single("deepseek", "DeepSeek", "@ai-sdk/deepseek", "^2", "createDeepSeek", "DEEPSEEK_API_KEY", ["language"]),
  single("moonshotai", "Moonshot AI", "@ai-sdk/moonshotai", "^2", "createMoonshotAI", "MOONSHOT_API_KEY", ["language"]),
  single("alibaba", "Alibaba", "@ai-sdk/alibaba", "^1", "createAlibaba", "DASHSCOPE_API_KEY", ["language", "embedding", "video"]),
  single("cerebras", "Cerebras", "@ai-sdk/cerebras", "^2", "createCerebras", "CEREBRAS_API_KEY", ["language"]),
  single("replicate", "Replicate", "@ai-sdk/replicate", "^2", "createReplicate", "REPLICATE_API_TOKEN", ["image", "video"]),
  single("prodia", "Prodia", "@ai-sdk/prodia", "^1", "createProdia", "PRODIA_API_KEY", ["image", "video"]),
  single("perplexity", "Perplexity", "@ai-sdk/perplexity", "^3", "createPerplexity", "PERPLEXITY_API_KEY", ["language"]),
  single("luma", "Luma", "@ai-sdk/luma", "^2", "createLuma", "LUMA_API_KEY", ["image", "video"]),
  single("bytedance", "ByteDance", "@ai-sdk/bytedance", "^1", "createByteDance", "BYTEDANCE_API_KEY", ["language", "image", "video"]),
  single("elevenlabs", "ElevenLabs", "@ai-sdk/elevenlabs", "^2", "createElevenLabs", "ELEVENLABS_API_KEY", ["speech", "transcription"]),
  single("assemblyai", "AssemblyAI", "@ai-sdk/assemblyai", "^2", "createAssemblyAI", "ASSEMBLYAI_API_KEY", ["transcription"]),
  single("deepgram", "Deepgram", "@ai-sdk/deepgram", "^2", "createDeepgram", "DEEPGRAM_API_KEY", ["speech", "transcription"]),
  single("gladia", "Gladia", "@ai-sdk/gladia", "^2", "createGladia", "GLADIA_API_KEY", ["transcription"]),
  single("lmnt", "LMNT", "@ai-sdk/lmnt", "^2", "createLMNT", "LMNT_API_KEY", ["speech"]),
  single("hume", "Hume", "@ai-sdk/hume", "^2", "createHume", "HUME_API_KEY", ["speech"]),
  single("revai", "Rev.ai", "@ai-sdk/revai", "^2", "createRevai", "REVAI_API_KEY", ["transcription"]),
  single("baseten", "Baseten", "@ai-sdk/baseten", "^1", "createBaseten", "BASETEN_API_KEY", ["language", "embedding"]),
  single("huggingface", "Hugging Face", "@ai-sdk/huggingface", "^1", "createHuggingFace", "HF_TOKEN", ["language", "embedding", "image"]),
  single("quiverai", "QuiverAI", "@ai-sdk/quiverai", "^1", "createQuiverAI", "QUIVER_API_KEY", ["language", "image"]),

  // ── Structured-credential providers (multiple secrets / required options ⇒ alias-only) ──
  {
    id: "azure",
    label: "Azure OpenAI",
    pkg: "@ai-sdk/azure",
    range: "^3",
    modalities: ["language", "embedding", "image", "speech", "transcription"],
    secrets: [KEY],
    options: [
      { name: "resourceName", label: "Resource name", required: true, placeholder: "my-azure-resource" },
      { name: "apiVersion", placeholder: "2024-10-01-preview" },
      { name: "baseURL", placeholder: "(overrides resourceName)" },
    ],
    make: (m, c, o) => m.createAzure({ resourceName: u(o.resourceName), apiKey: c.apiKey, apiVersion: u(o.apiVersion), baseURL: u(o.baseURL) }),
  },
  {
    id: "amazon-bedrock",
    label: "Amazon Bedrock",
    pkg: "@ai-sdk/amazon-bedrock",
    range: "^4",
    modalities: ["language", "embedding", "image"],
    secrets: [
      { name: "apiKey", label: "Bedrock API key (or use the AWS keys below)" },
      { name: "accessKeyId" },
      { name: "secretAccessKey" },
      { name: "sessionToken" },
    ],
    options: [{ name: "region", required: true, placeholder: "us-east-1" }],
    make: (m, c, o) =>
      m.createAmazonBedrock({ region: u(o.region), apiKey: u(c.apiKey), accessKeyId: u(c.accessKeyId), secretAccessKey: u(c.secretAccessKey), sessionToken: u(c.sessionToken) }),
  },
  {
    id: "anthropic-aws",
    label: "Claude on AWS",
    pkg: "@ai-sdk/anthropic-aws",
    range: "^1",
    modalities: ["language"],
    secrets: [
      { name: "apiKey", label: "Bedrock API key (or use the AWS keys below)" },
      { name: "accessKeyId" },
      { name: "secretAccessKey" },
      { name: "sessionToken" },
    ],
    options: [
      { name: "region", required: true, placeholder: "us-east-1" },
      { name: "workspaceId" },
    ],
    make: (m, c, o) =>
      m.createAnthropicAws({ region: u(o.region), workspaceId: u(o.workspaceId), apiKey: u(c.apiKey), accessKeyId: u(c.accessKeyId), secretAccessKey: u(c.secretAccessKey), sessionToken: u(c.sessionToken) }),
  },
  {
    id: "google-vertex",
    label: "Google Vertex AI",
    pkg: "@ai-sdk/google-vertex",
    range: "^4",
    modalities: ["language", "embedding", "image", "transcription", "video"],
    secrets: [{ name: "credentials", label: "Service-account JSON" }],
    options: [
      { name: "project", required: true, placeholder: "my-gcp-project" },
      { name: "location", placeholder: "us-central1" },
    ],
    make: (m, c, o) =>
      m.createVertex({ project: u(o.project), location: u(o.location), googleAuthOptions: c.credentials ? { credentials: JSON.parse(c.credentials) } : undefined }),
  },
  {
    id: "open-responses",
    label: "Open Responses",
    pkg: "@ai-sdk/open-responses",
    range: "^1",
    modalities: ["language", "image"],
    secrets: [{ name: "apiKey" }],
    options: [
      { name: "url", required: true, placeholder: "https://host/v1/responses" },
      { name: "name", placeholder: "open-responses" },
    ],
    make: (m, c, o) => m.createOpenResponses({ url: o.url, name: o.name || "open-responses", apiKey: u(c.apiKey) }),
  },
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    pkg: "@ai-sdk/openai-compatible",
    range: "^2",
    modalities: ["language", "embedding", "image"],
    secrets: [{ name: "apiKey" }],
    options: [
      { name: "baseURL", required: true, placeholder: "https://host/v1" },
      { name: "name", required: true, placeholder: "my-provider" },
    ],
    make: (m, c, o) => m.createOpenAICompatible({ baseURL: o.baseURL, name: o.name || "openai-compatible", apiKey: u(c.apiKey) }),
  },
  {
    id: "klingai",
    label: "Kling AI",
    pkg: "@ai-sdk/klingai",
    range: "^3",
    modalities: ["image", "video"],
    secrets: [
      { name: "accessKey", required: true },
      { name: "secretKey", required: true },
    ],
    make: (m, c) => m.createKlingAI({ accessKey: c.accessKey, secretKey: c.secretKey }),
  },
];

const BY_ID: Record<string, ProviderSpec> = Object.fromEntries(SPECS.map((s) => [s.id, s]));

export function getSpec(id: string): ProviderSpec | undefined {
  return BY_ID[id];
}

/** Public, serializable provider catalog for the settings form (no factories). */
export interface ProviderInfo {
  id: string;
  label: string;
  /** "gateway" for the built-in gateway, else "direct". */
  routing: "direct" | "gateway";
  /** Needs an optional @ai-sdk package the host must install (everything but the gateway). */
  optional: boolean;
  pkg: string;
  modalities: Modality[];
  secrets: SecretField[];
  options: OptionField[];
}

export function listProviders(): ProviderInfo[] {
  return SPECS.map((s) => ({
    id: s.id,
    label: s.label,
    routing: s.id === "gateway" ? "gateway" : "direct",
    optional: s.id !== "gateway",
    pkg: s.pkg,
    modalities: s.modalities,
    secrets: s.secrets,
    options: s.options ?? [],
  }));
}
