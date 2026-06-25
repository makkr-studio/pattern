/**
 * @pattern-js/mod-ai — the ProviderService: a ModelRef → a concrete AI SDK model.
 *
 * The ONE seam (with sdk.ts + registry.ts) that touches a provider. A ModelRef
 * resolves through an **alias** when `ref.alias` is set (a fully self-contained
 * model: provider + sourced secrets + structured options, incl. Azure/Bedrock/
 * Vertex), else inline (a single-key provider + one credential). Every direct
 * provider is an OPTIONAL peer, lazy-imported only when used (a clear install
 * hint if absent); the gateway ships with `ai`. Video forces an extended-timeout
 * fetch (it takes minutes).
 */

import type { OpContext } from "@pattern-js/core";
import type { ModelRef } from "@pattern-js/mod-agents";
import {
  createGateway,
  type EmbeddingModel,
  type ImageModel,
  type LanguageModel,
  type SpeechModel,
  type TranscriptionModel,
} from "./sdk.js";
import type { Alias, SecretRef } from "./types.js";
import { getSpec, type Creds, type ProviderSpec, type ProviderLike } from "./registry.js";
import { vaultLike } from "./well-known.js";

export { listProviders, type ProviderInfo } from "./registry.js";

const GATEWAY_SECRET = "AI_GATEWAY_API_KEY";

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
  /** Test an alias draft (resolves its secrets + builds the provider). */
  testAlias(alias: Alias, ctx: OpContext): Promise<{ ok: boolean; detail?: string }>;
  gatewayModels(ctx: OpContext): Promise<Record<string, unknown>[]>;
}

export class ProviderService implements AiProviderService {
  private gwCache?: { at: number; models: Record<string, unknown>[] };

  /** `lookup` resolves a ModelRef.alias name → an Alias (from AiConfigService). */
  constructor(private readonly lookup: (name: string) => Alias | undefined = () => undefined) {}

  /** Resolve a secret reference from its declared source (vault or env). Throws if absent. */
  private async resolveSourced(ctx: OpContext, ref: SecretRef): Promise<string> {
    if (ref.source === "env") {
      const v = ctx.env[ref.key];
      if (v) return v;
      throw new Error(`mod-ai: env var "${ref.key}" is not set.`);
    }
    const vault = vaultLike(ctx);
    if (vault?.unlocked() && (await vault.has(ref.key).catch(() => false))) return vault.read(ref.key);
    throw new Error(`mod-ai: no vault secret "${ref.key}" — add it in admin → System → Secrets.`);
  }

  /** Resolve a secret by NAME from env then the (unlocked) vault (inline + gateway default). */
  private async resolveByName(ctx: OpContext, name: string): Promise<string> {
    const v = await this.tryName(ctx, name);
    if (v) return v;
    throw new Error(`mod-ai: no secret "${name}" — add it in admin → System → Secrets, or set the ${name} env var.`);
  }

  private async tryName(ctx: OpContext, name: string): Promise<string | undefined> {
    const fromEnv = ctx.env[name];
    if (fromEnv) return fromEnv;
    const vault = vaultLike(ctx);
    if (vault?.unlocked() && (await vault.has(name).catch(() => false))) return vault.read(name);
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadPkg(spec: ProviderSpec): Promise<any> {
    try {
      const pkg = spec.pkg; // variable specifier ⇒ optional, not statically resolved
      return await import(pkg);
    } catch {
      throw new Error(
        `mod-ai: provider package "${spec.pkg}" is not installed — run \`npm i ${spec.pkg}\` (it is an optional provider).`,
      );
    }
  }

  /** Build the SDK provider for a fully-configured alias. */
  private async providerForAlias(alias: Alias, ctx: OpContext): Promise<ProviderLike> {
    if (alias.provider === "gateway") {
      return createGateway({ apiKey: await this.aliasGatewayKey(alias, ctx) }) as unknown as ProviderLike;
    }
    const spec = getSpec(alias.provider);
    if (!spec) throw this.unknownProvider(alias.provider);
    const creds: Creds = {};
    for (const [field, ref] of Object.entries(alias.secrets ?? {})) {
      if (ref?.key) creds[field] = await this.resolveSourced(ctx, ref);
    }
    return spec.make(await this.loadPkg(spec), creds, alias.options ?? {});
  }

  /** Build the SDK provider for a ModelRef (its alias when present, else inline single-key). */
  private async providerForRef(ref: ModelRef, ctx: OpContext): Promise<ProviderLike> {
    if (ref.alias) {
      const alias = this.lookup(ref.alias);
      if (!alias) {
        throw new Error(`mod-ai: alias "${ref.alias}" is not configured — set it in admin → Settings → AI Providers.`);
      }
      return this.providerForAlias(alias, ctx);
    }

    // Inline (alias-less ai.model): gateway, or a single-key direct provider.
    if (ref.routing === "gateway" || ref.provider === "gateway") {
      return createGateway({ apiKey: await this.resolveByName(ctx, ref.credential ?? GATEWAY_SECRET) }) as unknown as ProviderLike;
    }
    const spec = getSpec(ref.provider);
    if (!spec) throw this.unknownProvider(ref.provider);
    if (!spec.inlineSecret) {
      throw new Error(
        `mod-ai: provider "${ref.provider}" needs structured credentials — configure an alias for it in admin → Settings → AI Providers.`,
      );
    }
    const creds: Creds = { [spec.secrets[0]!.name]: await this.resolveByName(ctx, ref.credential ?? spec.inlineSecret) };
    return spec.make(await this.loadPkg(spec), creds, {});
  }

  private unknownProvider(id: string): Error {
    return new Error(
      `mod-ai: unknown provider "${id}". Pick one of the registry providers, or use "gateway" for any model through the Vercel AI Gateway.`,
    );
  }

  /** A model getter on a provider, with a friendly error when that provider lacks the modality. */
  private model<T>(prov: ProviderLike, method: keyof ProviderLike, ref: ModelRef): T {
    const fn = prov[method];
    if (typeof fn !== "function") {
      throw new Error(`mod-ai: provider "${ref.provider}" does not support ${String(method)} (model "${ref.modelId}").`);
    }
    return (fn as (id: string) => T).call(prov, ref.modelId);
  }

  async languageModel(ref: ModelRef, ctx: OpContext): Promise<LanguageModel> {
    return this.model<LanguageModel>(await this.providerForRef(ref, ctx), "languageModel", ref);
  }
  async textEmbeddingModel(ref: ModelRef, ctx: OpContext): Promise<EmbeddingModel> {
    return this.model<EmbeddingModel>(await this.providerForRef(ref, ctx), "textEmbeddingModel", ref);
  }
  async imageModel(ref: ModelRef, ctx: OpContext): Promise<ImageModel> {
    return this.model<ImageModel>(await this.providerForRef(ref, ctx), "imageModel", ref);
  }
  async speechModel(ref: ModelRef, ctx: OpContext): Promise<SpeechModel> {
    return this.model<SpeechModel>(await this.providerForRef(ref, ctx), "speechModel", ref);
  }
  async transcriptionModel(ref: ModelRef, ctx: OpContext): Promise<TranscriptionModel> {
    return this.model<TranscriptionModel>(await this.providerForRef(ref, ctx), "transcriptionModel", ref);
  }

  async videoModel(ref: ModelRef, ctx: OpContext): Promise<unknown> {
    // Gateway video is long-running ⇒ the extended-timeout dispatcher.
    if (ref.routing === "gateway" || ref.provider === "gateway" || this.aliasProvider(ref) === "gateway") {
      const apiKey = ref.alias
        ? await this.aliasGatewayKey(this.lookup(ref.alias)!, ctx)
        : await this.resolveByName(ctx, ref.credential ?? GATEWAY_SECRET);
      const gw = createGateway({ apiKey, fetch: await getVideoFetch() }) as unknown as ProviderLike;
      return this.model<unknown>(gw, "video", ref);
    }
    return this.model<unknown>(await this.providerForRef(ref, ctx), "video", ref);
  }

  private aliasProvider(ref: ModelRef): string | undefined {
    return ref.alias ? this.lookup(ref.alias)?.provider : undefined;
  }

  private async aliasGatewayKey(alias: Alias, ctx: OpContext): Promise<string> {
    const ref = alias.secrets?.apiKey;
    return ref?.key ? this.resolveSourced(ctx, ref) : this.resolveByName(ctx, GATEWAY_SECRET);
  }

  async testAlias(alias: Alias, ctx: OpContext): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.providerForAlias(alias, ctx); // exercises secret resolution + (lazy) provider construction
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async gatewayModels(ctx: OpContext): Promise<Record<string, unknown>[]> {
    const apiKey = await this.tryName(ctx, GATEWAY_SECRET);
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
