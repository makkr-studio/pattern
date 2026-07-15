/**
 * @pattern-js/mod-billing — service keys + duck-typed views of sibling mods.
 *
 * mod-store (the customer mapping + webhook dedup) and mod-identity (the
 * entitlement bridge) are looked up by their well-known service keys, never
 * imported — billing works without either (checkout still redirects, events
 * still emit; only the mapping/roles legs no-op with a warning).
 */

import { IDENTITY_SERVICE } from "@pattern-js/core";
import type { OpContext } from "@pattern-js/core";

/** Driver registry + account-resolving checkout/portal/usage/ingest surface. */
export const BILLING_SERVICE = "billingService";
/** Persisted billing accounts (.pattern-data/billing-config.json). */
export const BILLING_CONFIG_SERVICE = "billingConfig";

export { IDENTITY_SERVICE };

/* ── store (docs collections) ─────────────────────────────────────────── */

export const STORE_SERVICE_KEY = "storeService";

/** The slice of mod-store's DocumentStore this mod uses. */
export interface DocsLike {
  docs: {
    ensureCollection(def: { name: string; indexes: string[] }): Promise<void>;
    get(collection: string, id: string): Promise<{ id: string; data: Record<string, unknown>; version: number } | null>;
    put(
      collection: string,
      id: string,
      data: Record<string, unknown>,
      expectedVersion?: number,
    ): Promise<{ id: string; data: Record<string, unknown>; version: number } | null>;
    query(opts: {
      collection: string;
      where?: Record<string, unknown>;
      orderBy?: string;
      orderDir?: "asc" | "desc";
      limit?: number;
    }): Promise<Array<{ id: string; data: Record<string, unknown>; version: number }>>;
  };
}

export function docsStore(ctx: OpContext): DocsLike | undefined {
  const svc = ctx.services[STORE_SERVICE_KEY] as DocsLike | undefined;
  return svc?.docs ? svc : undefined;
}

/* ── identity (the roles bridge) ──────────────────────────────────────── */

/** The slice of mod-identity's service the entitlement projection uses. */
export interface IdentityLike {
  getUser(id: string): Promise<{ id: string; roles: string[] } | null>;
  findUserByEmail(email: string): Promise<{ id: string; roles: string[] } | null>;
  setRoles(userId: string, roles: string[]): Promise<unknown>;
}

export function identityLike(ctx: OpContext): IdentityLike | undefined {
  const svc = ctx.services[IDENTITY_SERVICE] as IdentityLike | undefined;
  return svc && typeof svc.setRoles === "function" ? svc : undefined;
}
