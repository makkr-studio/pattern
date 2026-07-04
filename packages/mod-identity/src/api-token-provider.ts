/**
 * @pattern-js/mod-identity — the API-token AuthProvider (0.4.0).
 *
 * The bridge from `Authorization: Bearer pat_…` to a principal, for the
 * control-plane surface (MCP server, admin API automation, CI). Returns null
 * fast when the header is absent or not token-shaped, so the session provider
 * and any custom providers get their turn.
 *
 * The principal's id is the TOKEN id (`apitoken:<id>`), not the minting
 * user's — audit trails then say which credential acted, which is the whole
 * point of named revocable tokens. No CSRF concerns here: bearer headers are
 * never attached cross-site by a browser.
 */

import type { AuthProvider, Principal } from "@pattern-js/core";
import { API_TOKEN_PREFIX, type IdentityService } from "./service.js";

export const API_TOKEN_PROVIDER_NAME = "@pattern-js/mod-identity/api-token";

export function apiTokenAuthProvider(svc: () => IdentityService | undefined): AuthProvider {
  return {
    name: API_TOKEN_PROVIDER_NAME,
    async authenticate(ctx): Promise<Principal | null> {
      const service = svc();
      if (!service) return null;

      const header = ctx.headers.get("authorization");
      if (!header) return null;
      const [scheme, raw] = header.split(/\s+/, 2);
      if (scheme?.toLowerCase() !== "bearer" || !raw?.startsWith(API_TOKEN_PREFIX)) return null;

      const row = await service.verifyApiToken(raw);
      if (!row) return null;

      return {
        kind: "user",
        id: `apitoken:${row.id}`,
        provider: API_TOKEN_PROVIDER_NAME,
        scopes: row.scopes,
        claims: {
          tokenId: row.id,
          tokenName: row.name,
          // The admin who minted it, when recorded — context, not authority.
          mintedBy: row.userId ?? undefined,
        },
      };
    },
  };
}
