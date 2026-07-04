/**
 * @pattern-js/mod-ai — service keys + duck-typed views of sibling mods.
 *
 * mod-store (blobs) and mod-vault (secrets) are looked up by their well-known
 * service keys, never imported — so mod-ai has no hard dependency on either.
 */

import type { OpContext } from "@pattern-js/core";

/** Builds an SDK model from a ModelRef (the only place that touches @ai-sdk). */
export const AI_PROVIDER_SERVICE = "aiProviderService";
/** The model + capability catalog (gateway /v1/models + a static fallback). */
export const AI_CATALOG_SERVICE = "aiModelCatalog";
/** Persisted provider/default-model settings. */
export const AI_CONFIG_SERVICE = "aiConfig";

/* ── vault (secrets) — hoisted to core; re-exported for existing importers ── */

export { VAULT_SERVICE_KEY, vaultLike, type VaultLike } from "@pattern-js/core";

/* ── store (blobs) ─────────────────────────────────────────────────────── */

export const STORE_SERVICE_KEY = "storeService";

export interface BlobMetaLike {
  id: string;
  mime: string;
  size: number;
}

export interface BlobStoreLike {
  blobs: {
    put(
      data: Uint8Array | ReadableStream<Uint8Array>,
      opts?: { mime?: string; ownerId?: string | null },
    ): Promise<BlobMetaLike>;
    get(id: string): Promise<{ meta: { mime: string }; stream: ReadableStream<Uint8Array> } | null>;
  };
}

export function blobStore(ctx: OpContext): BlobStoreLike {
  const svc = ctx.services[STORE_SERVICE_KEY] as BlobStoreLike | undefined;
  if (!svc) {
    throw new Error(
      "mod-ai: media ops need @pattern-js/mod-store installed — generated image/audio/video bytes land in its blob store.",
    );
  }
  return svc;
}
