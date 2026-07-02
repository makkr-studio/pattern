/**
 * @pattern-js/mod-auth-oidc — issuer discovery + JWKS, cached per mod instance.
 *
 * Discovery is fetched lazily on the first login attempt (not at boot — an
 * unreachable IdP must not take the app down) and cached for the process
 * lifetime; failures are NOT cached so a flaky IdP heals on the next attempt.
 * JWKS verification is jose's remote set, which refetches on unknown key ids
 * — IdP key rotation needs no restart. An IdP that migrates its token
 * endpoint does (documented).
 */

import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

export interface DiscoveryDoc {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const REQUIRED: Array<keyof DiscoveryDoc> = ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"];

export class OidcRuntime {
  private readonly discoveries = new Map<string, Promise<DiscoveryDoc>>();
  private readonly jwks = new Map<string, JWTVerifyGetKey>();

  discovery(issuer: string): Promise<DiscoveryDoc> {
    const base = issuer.replace(/\/$/, "");
    let hit = this.discoveries.get(base);
    if (!hit) {
      hit = (async (): Promise<DiscoveryDoc> => {
        const res = await fetch(`${base}/.well-known/openid-configuration`);
        if (!res.ok) throw new Error(`mod-auth-oidc: discovery failed for ${base} (${res.status}).`);
        const doc = (await res.json()) as Record<string, unknown>;
        for (const key of REQUIRED) {
          if (typeof doc[key] !== "string") {
            throw new Error(`mod-auth-oidc: discovery document for ${base} is missing "${key}".`);
          }
        }
        return doc as unknown as DiscoveryDoc;
      })();
      hit.catch(() => this.discoveries.delete(base)); // never cache a failure
      this.discoveries.set(base, hit);
    }
    return hit;
  }

  keysFor(jwksUri: string): JWTVerifyGetKey {
    let set = this.jwks.get(jwksUri);
    if (!set) {
      set = createRemoteJWKSet(new URL(jwksUri));
      this.jwks.set(jwksUri, set);
    }
    return set;
  }
}
