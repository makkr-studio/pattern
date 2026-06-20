/** @pattern-js/mod-vault — the well-known service seam. */

import type { OpContext } from "@pattern-js/core";
import type { VaultService } from "./service.js";

export const VAULT_SERVICE = "vaultService";

export function vaultService(ctx: OpContext): VaultService {
  const svc = ctx.services[VAULT_SERVICE] as VaultService | undefined;
  if (!svc) {
    throw new Error(
      'vault ops need @pattern-js/mod-vault installed — add "@pattern-js/mod-vault" to your pattern.config.json mods',
    );
  }
  return svc;
}
