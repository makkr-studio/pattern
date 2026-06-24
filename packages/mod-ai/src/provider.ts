/**
 * @pattern-js/mod-ai — the ProviderService: ModelRef → a concrete AI SDK model.
 *
 * The ONE seam (with sdk.ts) that touches @ai-sdk. Resolves a model two ways:
 *  - gateway: createGateway({ apiKey }) → one key, "provider/model" ids, BYOK,
 *  - direct:  a native @ai-sdk/<provider> factory + that provider's key.
 * Keys come from the ModelRef.credential or a per-routing default, resolved via
 * the env then the vault. Video forces an extended-timeout fetch (it takes minutes).
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
import { vaultLike } from "./well-known.js";

/** A provider exposes the standard model factories (gateway + native both do). */
interface ProviderLike {
  languageModel(id: string): LanguageModel;
  textEmbeddingModel(id: string): EmbeddingModel;
  imageModel(id: string): ImageModel;
  speechModel(id: string): SpeechModel;
  transcriptionModel(id: string): TranscriptionModel;
}

/** The gateway adds a video factory the native providers don't expose. */
interface GatewayLike extends ProviderLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  video(id: string): any;
}

const DIRECT: Record<string, { make: (o: { apiKey: string }) => unknown; secret: string }> = {
  openai: { make: (o) => createOpenAI(o), secret: "OPENAI_API_KEY" },
  anthropic: { make: (o) => createAnthropic(o), secret: "ANTHROPIC_API_KEY" },
  google: { make: (o) => createGoogleGenerativeAI(o), secret: "GOOGLE_GENERATIVE_AI_API_KEY" },
  mistral: { make: (o) => createMistral(o), secret: "MISTRAL_API_KEY" },
  groq: { make: (o) => createGroq(o), secret: "GROQ_API_KEY" },
};

const GATEWAY_SECRET = "AI_GATEWAY_API_KEY";

/** Long video generations exceed undici's default 5-minute timeout. */
const VIDEO_TIMEOUT_MS = 15 * 60 * 1000;
let videoFetch: typeof fetch | undefined;
let videoFetchTried = false;
async function getVideoFetch(): Promise<typeof fetch | undefined> {
  if (videoFetchTried) return videoFetch;
  videoFetchTried = true;
  try {
    // A variable specifier keeps TS from statically resolving undici (it's a
    // built-in/transitive, not a declared dep); absent, we fall back gracefully.
    const spec = "undici";
    const { Agent } = (await import(spec)) as { Agent: new (o: unknown) => unknown };
    const dispatcher = new Agent({ headersTimeout: VIDEO_TIMEOUT_MS, bodyTimeout: VIDEO_TIMEOUT_MS });
    videoFetch = ((url: string | URL | Request, init?: RequestInit) =>
      fetch(url, { ...init, dispatcher } as RequestInit & { dispatcher: unknown })) as typeof fetch;
  } catch {
    videoFetch = undefined; // undici unavailable — fall back to the default 5-min fetch.
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
  /** The live gateway /v1/models listing (raw entries); [] when no gateway key resolves. */
  gatewayModels(ctx: OpContext): Promise<Record<string, unknown>[]>;
}

export class ProviderService implements AiProviderService {
  private gwCache?: { at: number; models: Record<string, unknown>[] };

  /** Resolve a secret by name from the env then the (unlocked) vault. Undefined if absent. */
  private async tryKey(ctx: OpContext, name: string): Promise<string | undefined> {
    const fromEnv = ctx.env[name];
    if (fromEnv) return fromEnv;
    const vault = vaultLike(ctx);
    if (vault?.unlocked() && (await vault.has(name).catch(() => false))) return vault.read(name);
    return undefined;
  }

  private async resolveKey(ctx: OpContext, ref: ModelRef, fallback: string): Promise<string> {
    const name = ref.credential ?? fallback;
    const key = await this.tryKey(ctx, name);
    if (key) return key;
    throw new Error(
      `mod-ai: no credential "${name}" — store it in the vault (admin → Settings → AI Providers), set the ${name} env var, or set ModelRef.credential.`,
    );
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
      return this.gwCache?.models ?? []; // keep last good / fall back to static-only
    }
  }

  private async provider(ref: ModelRef, ctx: OpContext): Promise<ProviderLike> {
    if (ref.routing === "gateway") {
      const apiKey = await this.resolveKey(ctx, ref, GATEWAY_SECRET);
      return createGateway({ apiKey }) as unknown as ProviderLike;
    }
    const spec = DIRECT[ref.provider];
    if (!spec) {
      throw new Error(
        `mod-ai: unknown direct provider "${ref.provider}" (known: ${Object.keys(DIRECT).join(", ")}). Use routing "gateway" for any other provider.`,
      );
    }
    const apiKey = await this.resolveKey(ctx, ref, spec.secret);
    return spec.make({ apiKey }) as ProviderLike;
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
    const apiKey = await this.resolveKey(ctx, ref, GATEWAY_SECRET);
    const gw = createGateway({ apiKey, fetch: await getVideoFetch() }) as unknown as GatewayLike;
    return gw.video(ref.modelId);
  }

  async testConnection(ref: ModelRef, ctx: OpContext): Promise<{ ok: boolean; detail?: string }> {
    try {
      // Resolving the model exercises key resolution + provider construction.
      await this.provider(ref, ctx);
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
