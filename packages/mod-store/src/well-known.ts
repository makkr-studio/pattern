/**
 * @pattern-js/mod-store — the well-known service seam.
 *
 * Other mods (chat, agents…) reach the stores through
 * `engine.service(STORE_SERVICE)` / `ctx.services[STORE_SERVICE]` and this
 * package's types — never through mod internals. Consumers should call
 * `docs.ensureCollection` from their `ready` (mod-store's `setup` has run by
 * then regardless of listing order).
 */

import type { OpContext } from "@pattern-js/core";
import type { PatternStores } from "./store/types.js";

export const STORE_SERVICE = "storeService";

/** The stores from an op context, with a friendly error when absent. */
export function storeService(ctx: OpContext): PatternStores {
  const svc = ctx.services[STORE_SERVICE] as PatternStores | undefined;
  if (!svc) {
    throw new Error(
      'store ops need @pattern-js/mod-store installed — add "@pattern-js/mod-store" to your pattern.config.json mods',
    );
  }
  return svc;
}
