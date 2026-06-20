/**
 * @pattern-js/mod-identity — service access for ops.
 *
 * The key itself (`IDENTITY_SERVICE`) lives in core so consumers that only
 * need presence-detection (the admin's secure-by-default) never import this
 * package. This module is the typed accessor for code that does.
 */

import { IDENTITY_SERVICE, type OpContext } from "@pattern-js/core";
import type { IdentityService } from "./service.js";

export { IDENTITY_SERVICE };

export function identityService(ctx: OpContext): IdentityService {
  const svc = ctx.services[IDENTITY_SERVICE] as IdentityService | undefined;
  if (!svc) throw new Error("identity service is not registered (install @pattern-js/mod-identity)");
  return svc;
}
