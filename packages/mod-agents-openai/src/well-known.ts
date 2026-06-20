/**
 * @pattern-js/mod-agents-openai — provider-local service keys.
 *
 * MODEL_PROVIDER_SERVICE: an engine service that, when present, overrides the
 * OpenAI model provider for every agents.run — the seam tests use to script
 * model behavior without an API key, and apps could use to swap in any
 * ModelProvider-compatible backend (e.g. the aisdk adapter).
 */

export const MODEL_PROVIDER_SERVICE = "agents.openai.modelProvider";

/**
 * Duck-typed view of @pattern-js/mod-store's service — looked up by its
 * well-known key so this package never imports mod-store (image parts carry
 * blob ids; resolving them needs the blob store when present).
 */
export const STORE_SERVICE_KEY = "storeService";

export interface BlobStoreLike {
  blobs: {
    get(id: string): Promise<{ meta: { mime: string }; stream: ReadableStream<Uint8Array> } | null>;
  };
}
