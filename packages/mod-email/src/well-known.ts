/**
 * @pattern-js/mod-email — service keys + duck-typed views of sibling mods.
 *
 * mod-vault (secrets) and mod-store (blob attachments) are looked up by their
 * well-known service keys, never imported — mod-email has no hard dependency
 * on either. (VaultLike now lives in core; BlobStoreLike stays local.)
 */

import type { OpContext } from "@pattern-js/core";

/** Driver registry + account-resolving send/test (the contract surface). */
export const EMAIL_SERVICE = "emailService";
/** Persisted email accounts (.pattern-data/email-config.json). */
export const EMAIL_CONFIG_SERVICE = "emailConfig";

/* ── vault (secrets) — hoisted to core; re-exported for existing importers ── */

export { VAULT_SERVICE_KEY, vaultLike, type VaultLike } from "@pattern-js/core";

/* ── store (blob attachments) ──────────────────────────────────────────── */

export const STORE_SERVICE_KEY = "storeService";

export interface BlobStoreLike {
  blobs: {
    get(id: string): Promise<{ meta: { mime: string }; stream: ReadableStream<Uint8Array> } | null>;
  };
}

/** Only reached when a MediaRef attachment is wired — hence the lazy throw. */
export function blobStore(ctx: OpContext): BlobStoreLike {
  const svc = ctx.services[STORE_SERVICE_KEY] as BlobStoreLike | undefined;
  if (!svc) {
    throw new Error(
      "mod-email: attaching a blob reference ({blobId}) needs @pattern-js/mod-store installed — its blob store holds the bytes.",
    );
  }
  return svc;
}
