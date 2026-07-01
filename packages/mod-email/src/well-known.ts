/**
 * @pattern-js/mod-email — service keys + duck-typed views of sibling mods.
 *
 * mod-vault (secrets) and mod-store (blob attachments) are looked up by their
 * well-known service keys, never imported — mod-email has no hard dependency
 * on either. (The VaultLike/BlobStoreLike shapes mirror mod-ai's copies; a
 * future hoist to core would collapse the three.)
 */

import type { OpContext } from "@pattern-js/core";

/** Driver registry + account-resolving send/test (the contract surface). */
export const EMAIL_SERVICE = "emailService";
/** Persisted email accounts (.pattern-data/email-config.json). */
export const EMAIL_CONFIG_SERVICE = "emailConfig";

/* ── vault (secrets) ───────────────────────────────────────────────────── */

export const VAULT_SERVICE_KEY = "vaultService";

export interface VaultLike {
  unlocked(): boolean;
  has(name: string): Promise<boolean>;
  read(name: string): Promise<string>;
}

export function vaultLike(ctx: OpContext): VaultLike | undefined {
  return ctx.services[VAULT_SERVICE_KEY] as VaultLike | undefined;
}

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
