/**
 * @pattern-js/mod-identity — the session AuthProvider (§9).
 *
 * The bridge from cookie to principal, run by the engine's provider chain on
 * every authenticated surface (HTTP routes, app mounts, WS upgrades — they
 * all call `engine.authenticate`). Returns null fast when the cookie is
 * absent so other providers (API keys, bearer tokens) get their turn.
 *
 * CSRF lives here by design: a cross-site state-changing request simply does
 * not authenticate, so protected writes 401 without any token machinery.
 */

import type { AuthProvider, Principal } from "@pattern-js/core";
import type { IdentityService } from "./service.js";
import { parseCookies } from "./cookies.js";
import { isCrossSiteWrite, isStateChanging, methodOf } from "./csrf.js";

export const SESSION_PROVIDER_NAME = "@pattern-js/mod-identity/session";

export function sessionAuthProvider(svc: () => IdentityService | undefined): AuthProvider {
  return {
    name: SESSION_PROVIDER_NAME,
    async authenticate(ctx): Promise<Principal | null> {
      const service = svc();
      if (!service) return null;

      const raw = parseCookies(ctx.headers.get("cookie"))[service.options.cookieName];
      if (!raw) return null;

      // CSRF: refuse to authenticate cross-site writes (GETs always pass —
      // the magic-link callback is a cross-site top-level GET by nature).
      if (isStateChanging(methodOf(ctx.raw)) && isCrossSiteWrite(ctx.headers)) return null;

      const resolved = await service.resolveSessionByToken(raw);
      if (!resolved) return null;

      return {
        kind: "user",
        id: resolved.user.id,
        provider: SESSION_PROVIDER_NAME,
        scopes: resolved.scopes,
        claims: {
          sessionId: resolved.session.id, // WS hosts join session:{id} with this
          email: resolved.user.email,
          name: resolved.user.name ?? undefined,
          roles: resolved.user.roles,
        },
      };
    },
  };
}
