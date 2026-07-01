/**
 * @pattern-js/mod-auth-oidc — sourced-secret resolution (vault or env).
 *
 * The same tiny pattern as mod-ai/mod-email (duck-typed vault, never a hard
 * dependency); a future core hoist would collapse the copies.
 */

import type { OpContext } from "@pattern-js/core";
import type { SecretRef } from "./options.js";

const VAULT_SERVICE_KEY = "vaultService";

interface VaultLike {
  unlocked(): boolean;
  has(name: string): Promise<boolean>;
  read(name: string): Promise<string>;
}

export async function resolveSourced(ctx: OpContext, ref: SecretRef): Promise<string> {
  if (ref.source === "env") {
    const v = ctx.env[ref.key];
    if (v) return v;
    throw new Error(`mod-auth-oidc: env var "${ref.key}" is not set.`);
  }
  const vault = ctx.services[VAULT_SERVICE_KEY] as VaultLike | undefined;
  if (vault?.unlocked() && (await vault.has(ref.key).catch(() => false))) return vault.read(ref.key);
  throw new Error(
    `mod-auth-oidc: no vault secret "${ref.key}" — add it in admin → System → Secrets (vault must be unlocked).`,
  );
}
