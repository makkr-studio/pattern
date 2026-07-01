/**
 * @pattern-js/mod-auth-oidc — options.
 *
 * Code-configured on purpose: OIDC wiring is deploy-time, security-critical
 * state (issuer, client id, redirect URIs registered at the IdP), so it lives
 * in a small wrapper mod, not admin CRUD. Only the client SECRET is sourced at
 * run time — from the vault or an env var, same `{source, key}` scheme as
 * mod-ai and mod-email.
 */

import { z } from "@pattern-js/core";

export const secretRefSchema = z.object({
  source: z.enum(["vault", "env"]).default("vault"),
  /** The vault secret name or the env-var name (never the value). */
  key: z.string(),
});
export type SecretRef = z.infer<typeof secretRefSchema>;

export const oidcProviderSchema = z.object({
  /** URL-safe handle — it names the routes (/auth/oidc/<id>/…) and the identity link ("oidc:<id>"). */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id must be lowercase url-safe (a-z, 0-9, -)"),
  /** The login-page button text. Default "Continue with <id>". */
  label: z.string().optional(),
  /** The issuer URL — discovery lives at <issuer>/.well-known/openid-configuration. */
  issuer: z.url(),
  clientId: z.string().min(1),
  clientSecret: secretRefSchema,
  /** Default ["openid", "email", "profile"]. */
  scopes: z.array(z.string()).optional(),
  /**
   * By default only IdP-verified emails sign in: `findOrCreateByIdentity`
   * links accounts BY EMAIL, so accepting an unverified claim would let a
   * rogue account at the IdP take over a local user. Opting in accepts that
   * risk (e.g. a trusted in-house issuer that never sets email_verified).
   */
  allowUnverifiedEmail: z.boolean().default(false),
});
export type OidcProvider = z.infer<typeof oidcProviderSchema>;

export const oidcOptionsSchema = z.object({
  providers: z.array(oidcProviderSchema).default([]),
  /** Must match the identity mod's mount. Default "/auth". */
  mount: z.string().default("/auth"),
});

export interface OidcOptions {
  providers?: Array<z.input<typeof oidcProviderSchema>>;
  mount?: string;
}

export interface ResolvedOidcOptions {
  providers: OidcProvider[];
  mount: string;
}

export function resolveOptions(options: OidcOptions): ResolvedOidcOptions {
  const parsed = oidcOptionsSchema.parse(options);
  const seen = new Set<string>();
  for (const p of parsed.providers) {
    if (seen.has(p.id)) throw new Error(`mod-auth-oidc: duplicate provider id "${p.id}".`);
    seen.add(p.id);
  }
  return { providers: parsed.providers, mount: parsed.mount.replace(/\/$/, "") || "/auth" };
}
