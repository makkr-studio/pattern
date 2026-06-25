/**
 * @pattern-js/mod-ai — the ProviderService: ModelRef → a concrete AI SDK model.
 *
 * The ONE seam (with sdk.ts) that touches @ai-sdk. A ModelRef resolves through a
 * Connection when `ref.connection` is set (provider + routing + explicit vault
 * secrets, incl. structured creds for Azure/Bedrock/Vertex), else inline
 * (provider + a single credential). Providers are a descriptor registry: the
 * five baseline ones are bundled; the rest are OPTIONAL peers, dynamically
 * imported only when used (a clear install hint if absent). Video forces an
 * extended-timeout fetch (it takes minutes).
 */

import type { OpContext } from "@pattern-js/core";
import type { ModelRef } from "@pattern-js/mod-agents";
import {
  createAnthropic,
  createGateway,
  createGoogleGenerativeAI,
  createGroq,
  createMistral,
  createOpenAI,
  type EmbeddingModel,
  type ImageModel,
  type LanguageModel,
  type SpeechModel,
  type TranscriptionModel,
} from "./sdk.js";
import type { Connection } from "./types.js";
import { vaultLike } from "./well-known.js";

/** A provider exposes the standard model factories (gateway + native both do). */
interface ProviderLike {
  languageModel(id: string): LanguageModel;
  textEmbeddingModel(id: string): EmbeddingModel;
  imageModel(id: string): ImageModel;
  speechModel(id: string): SpeechModel;
  transcriptionModel(id: string): TranscriptionModel;
}
interface GatewayLike extends ProviderLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  video(id: string): any;
}

type Creds = Record<string, string>;
type Opts = Record<string, string>;

interface ProviderSpec {
  label: string;
  /** npm package — the install hint + the dynamic-import specifier for optional ones. */
  pkg: string;
  /** Bundled with mod-ai (hard dep); optional providers are lazy-imported peers. */
  baseline?: boolean;
  /** Vault-backed auth fields a Connection supplies (drives the settings form). */
  secretFields: string[];
  /** Non-secret structured fields a Connection supplies (region, resourceName, …). */
  optionFields?: string[];
  /** Default secret name for INLINE (connection-less) use; absent ⇒ a Connection is required. */
  defaultSecret?: string;
  /** Build the provider from resolved secret VALUES + structured options. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  make(mod: any, creds: Creds, opts: Opts): ProviderLike;
}

/** The provider registry. Baseline five use sdk.ts factories; the rest are lazy peers. */
const SPECS: Record<string, ProviderSpec> = {
  // ── Baseline (bundled) ──
  openai: { label: "OpenAI", pkg: "@ai-sdk/openai", baseline: true, secretFields: ["apiKey"], defaultSecret: "OPENAI_API_KEY", make: (_m, c) => createOpenAI({ apiKey: c.apiKey }) as unknown as ProviderLike },
  anthropic: { label: "Anthropic", pkg: "@ai-sdk/anthropic", baseline: true, secretFields: ["apiKey"], defaultSecret: "ANTHROPIC_API_KEY", make: (_m, c) => createAnthropic({ apiKey: c.apiKey }) as unknown as ProviderLike },
  google: { label: "Google Generative AI", pkg: "@ai-sdk/google", baseline: true, secretFields: ["apiKey"], defaultSecret: "GOOGLE_GENERATIVE_AI_API_KEY", make: (_m, c) => createGoogleGenerativeAI({ apiKey: c.apiKey }) as unknown as ProviderLike },
  mistral: { label: "Mistral", pkg: "@ai-sdk/mistral", baseline: true, secretFields: ["apiKey"], defaultSecret: "MISTRAL_API_KEY", make: (_m, c) => createMistral({ apiKey: c.apiKey }) as unknown as ProviderLike },
  groq: { label: "Groq", pkg: "@ai-sdk/groq", baseline: true, secretFields: ["apiKey"], defaultSecret: "GROQ_API_KEY", make: (_m, c) => createGroq({ apiKey: c.apiKey }) as unknown as ProviderLike },

  // ── Optional single-key providers (lazy peers) ──
  xai: { label: "xAI (Grok)", pkg: "@ai-sdk/xai", secretFields: ["apiKey"], defaultSecret: "XAI_API_KEY", make: (m, c) => m.createXai({ apiKey: c.apiKey }) },
  deepseek: { label: "DeepSeek", pkg: "@ai-sdk/deepseek", secretFields: ["apiKey"], defaultSecret: "DEEPSEEK_API_KEY", make: (m, c) => m.createDeepSeek({ apiKey: c.apiKey }) },
  cohere: { label: "Cohere", pkg: "@ai-sdk/cohere", secretFields: ["apiKey"], defaultSecret: "COHERE_API_KEY", make: (m, c) => m.createCohere({ apiKey: c.apiKey }) },
  togetherai: { label: "Together AI", pkg: "@ai-sdk/togetherai", secretFields: ["apiKey"], defaultSecret: "TOGETHER_AI_API_KEY", make: (m, c) => m.createTogetherAI({ apiKey: c.apiKey }) },
  fireworks: { label: "Fireworks", pkg: "@ai-sdk/fireworks", secretFields: ["apiKey"], defaultSecret: "FIREWORKS_API_KEY", make: (m, c) => m.createFireworks({ apiKey: c.apiKey }) },
  cerebras: { label: "Cerebras", pkg: "@ai-sdk/cerebras", secretFields: ["apiKey"], defaultSecret: "CEREBRAS_API_KEY", make: (m, c) => m.createCerebras({ apiKey: c.apiKey }) },
  perplexity: { label: "Perplexity", pkg: "@ai-sdk/perplexity", secretFields: ["apiKey"], defaultSecret: "PERPLEXITY_API_KEY", make: (m, c) => m.createPerplexity({ apiKey: c.apiKey }) },

  // ── Optional structured-credential providers (a Connection is required) ──
  azure: {
    label: "Azure OpenAI",
    pkg: "@ai-sdk/azure",
    secretFields: ["apiKey"],
    optionFields: ["resourceName", "apiVersion", "baseURL"],
    make: (m, c, o) => m.createAzure({ resourceName: o.resourceName || undefined, apiKey: c.apiKey, apiVersion: o.apiVersion || undefined, baseURL: o.baseURL || undefined }),
  },
  "amazon-bedrock": {
    label: "Amazon Bedrock",
    pkg: "@ai-sdk/amazon-bedrock",
    secretFields: ["accessKeyId", "secretAccessKey", "sessionToken"],
    optionFields: ["region"],
    make: (m, c, o) => m.createAmazonBedrock({ region: o.region || undefined, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, sessionToken: c.sessionToken || undefined }),
  },
  "google-vertex": {
    label: "Google Vertex AI",
    pkg: "@ai-sdk/google-vertex",
    secretFields: ["credentials"],
    optionFields: ["project", "location"],
    make: (m, c, o) =>
      m.createVertex({ project: o.project || undefined, location: o.location || undefined, googleAuthOptions: c.credentials ? { credentials: JSON.parse(c.credentials) } : undefined }),
  },
};

const GATEWAY_SECRET = "AI_GATEWAY_API_KEY";

/** Public, serializable provider catalog for the settings form (no factories). */
export interface ProviderInfo {
  provider: string;
  label: string;
  /** "gateway" for the gateway pseudo-provider, else "direct". */
  routing: "direct" | "gateway";
  /** Needs an optional @ai-sdk package the host must install. */
  optional: boolean;
  pkg: string;
  secretFields: string[];
  optionFields: string[];
}

export function listProviders(): ProviderInfo[] {
  const direct = Object.entries(SPECS).map(([provider, s]) => ({
    provider,
    label: s.label,
    routing: "direct" as const,
    optional: !s.baseline,
    pkg: s.pkg,
    secretFields: s.secretFields,
    optionFields: s.optionFields ?? [],
  }));
  return [
    { provider: "gateway", label: "Vercel AI Gateway", routing: "gateway", optional: false, pkg: "@ai-sdk/gateway", secretFields: ["apiKey"], optionFields: [] },
    ...direct,
  ];
}

/** Long video generations exceed undici's default 5-minute timeout. */
const VIDEO_TIMEOUT_MS = 15 * 60 * 1000;
let videoFetch: typeof fetch | undefined;
let videoFetchTried = false;
async function getVideoFetch(): Promise<typeof fetch | undefined> {
  if (videoFetchTried) return videoFetch;
  videoFetchTried = true;
  try {
    const spec = "undici";
    const { Agent } = (await import(spec)) as { Agent: new (o: unknown) => unknown };
    const dispatcher = new Agent({ headersTimeout: VIDEO_TIMEOUT_MS, bodyTimeout: VIDEO_TIMEOUT_MS });
    videoFetch = ((url: string | URL | Request, init?: RequestInit) =>
      fetch(url, { ...init, dispatcher } as RequestInit & { dispatcher: unknown })) as typeof fetch;
  } catch {
    videoFetch = undefined;
  }
  return videoFetch;
}

export interface AiProviderService {
  languageModel(ref: ModelRef, ctx: OpContext): Promise<LanguageModel>;
  textEmbeddingModel(ref: ModelRef, ctx: OpContext): Promise<EmbeddingModel>;
  imageModel(ref: ModelRef, ctx: OpContext): Promise<ImageModel>;
  speechModel(ref: ModelRef, ctx: OpContext): Promise<SpeechModel>;
  transcriptionModel(ref: ModelRef, ctx: OpContext): Promise<TranscriptionModel>;
  videoModel(ref: ModelRef, ctx: OpContext): Promise<unknown>;
  testConnection(ref: ModelRef, ctx: OpContext): Promise<{ ok: boolean; detail?: string }>;
  gatewayModels(ctx: OpContext): Promise<Record<string, unknown>[]>;
}

export class ProviderService implements AiProviderService {
  private gwCache?: { at: number; models: Record<string, unknown>[] };

  /** `lookup` resolves a ModelRef.connection id → a Connection (from AiConfigService). */
  constructor(private readonly lookup: (id: string) => Connection | undefined = () => undefined) {}

  /** Resolve a secret by name from the env then the (unlocked) vault. Undefined if absent. */
  private async tryKey(ctx: OpContext, name: string): Promise<string | undefined> {
    const fromEnv = ctx.env[name];
    if (fromEnv) return fromEnv;
    const vault = vaultLike(ctx);
    if (vault?.unlocked() && (await vault.has(name).catch(() => false))) return vault.read(name);
    return undefined;
  }

  private async resolveSecret(ctx: OpContext, name: string): Promise<string> {
    const key = await this.tryKey(ctx, name);
    if (key) return key;
    throw new Error(
      `mod-ai: no secret "${name}" — add it in admin → System → Secrets, or set the ${name} env var.`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadPkg(spec: ProviderSpec): Promise<any> {
    if (spec.baseline) return undefined; // baseline factories come from sdk.ts
    try {
      const pkg = spec.pkg; // variable specifier ⇒ optional, not statically resolved
      return await import(pkg);
    } catch {
      throw new Error(
        `mod-ai: provider package "${spec.pkg}" is not installed — run \`npm i ${spec.pkg}\` (it is an optional provider).`,
      );
    }
  }

  /** Build the SDK provider for a ref (via its Connection when present, else inline). */
  private async provider(ref: ModelRef, ctx: OpContext): Promise<ProviderLike> {
    const conn = ref.connection ? this.lookup(ref.connection) : undefined;
    const routing = conn?.routing ?? ref.routing;

    if (routing === "gateway") {
      const apiKey = await this.resolveSecret(ctx, conn?.secrets.apiKey ?? ref.credential ?? GATEWAY_SECRET);
      return createGateway({ apiKey }) as unknown as ProviderLike;
    }

    const providerId = conn?.provider ?? ref.provider;
    const spec = SPECS[providerId];
    if (!spec) {
      throw new Error(
        `mod-ai: unknown direct provider "${providerId}" (known: ${Object.keys(SPECS).join(", ")}). Use routing "gateway" for any other provider.`,
      );
    }

    const creds: Creds = {};
    if (conn) {
      for (const field of spec.secretFields) {
        const secretName = conn.secrets[field];
        if (secretName) creds[field] = await this.resolveSecret(ctx, secretName);
      }
    } else {
      if (!spec.defaultSecret) {
        throw new Error(
          `mod-ai: provider "${providerId}" needs structured credentials — configure a Connection for it in admin → Settings → AI Providers.`,
        );
      }
      creds[spec.secretFields[0]!] = await this.resolveSecret(ctx, ref.credential ?? spec.defaultSecret);
    }

    return spec.make(await this.loadPkg(spec), creds, conn?.options ?? {});
  }

  async languageModel(ref: ModelRef, ctx: OpContext): Promise<LanguageModel> {
    return (await this.provider(ref, ctx)).languageModel(ref.modelId);
  }
  async textEmbeddingModel(ref: ModelRef, ctx: OpContext): Promise<EmbeddingModel> {
    return (await this.provider(ref, ctx)).textEmbeddingModel(ref.modelId);
  }
  async imageModel(ref: ModelRef, ctx: OpContext): Promise<ImageModel> {
    return (await this.provider(ref, ctx)).imageModel(ref.modelId);
  }
  async speechModel(ref: ModelRef, ctx: OpContext): Promise<SpeechModel> {
    return (await this.provider(ref, ctx)).speechModel(ref.modelId);
  }
  async transcriptionModel(ref: ModelRef, ctx: OpContext): Promise<TranscriptionModel> {
    return (await this.provider(ref, ctx)).transcriptionModel(ref.modelId);
  }
  async videoModel(ref: ModelRef, ctx: OpContext): Promise<unknown> {
    // Video is gateway-first and long-running; build a gateway with the extended timeout.
    const conn = ref.connection ? this.lookup(ref.connection) : undefined;
    const apiKey = await this.resolveSecret(ctx, conn?.secrets.apiKey ?? ref.credential ?? GATEWAY_SECRET);
    const gw = createGateway({ apiKey, fetch: await getVideoFetch() }) as unknown as GatewayLike;
    return gw.video(ref.modelId);
  }

  async testConnection(ref: ModelRef, ctx: OpContext): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.provider(ref, ctx); // exercises key resolution + (lazy) provider construction
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async gatewayModels(ctx: OpContext): Promise<Record<string, unknown>[]> {
    const apiKey = await this.tryKey(ctx, GATEWAY_SECRET);
    if (!apiKey) return [];
    if (this.gwCache && Date.now() - this.gwCache.at < 5 * 60 * 1000) return this.gwCache.models;
    try {
      const gw = createGateway({ apiKey }) as unknown as {
        getAvailableModels(): Promise<{ models?: Record<string, unknown>[] }>;
      };
      const models = (await gw.getAvailableModels()).models ?? [];
      this.gwCache = { at: Date.now(), models };
      return models;
    } catch {
      return this.gwCache?.models ?? [];
    }
  }
}
