/**
 * Sourced secret references — the ONE way mods point at credentials.
 *
 * Auth VALUES are never stored in config or on ports: a `SecretRef` names
 * either a vault secret (managed in admin → System → Secrets) or an env var,
 * resolved at run time. The source is chosen explicitly per field, so nothing
 * relies on guessing a provider's magic env-var convention.
 *
 * Hoisted here from mod-ai / mod-email (identical copies) once a third
 * consumer appeared; mod-vault stays duck-typed via its well-known service key
 * so core keeps zero knowledge of the vault implementation.
 */

import { z } from "zod";
import type { OpContext } from "./types.js";

export const secretRefSchema = z.object({
  source: z.enum(["vault", "env"]).default("vault"),
  /** The vault secret name or the env-var name (never the value). */
  key: z.string(),
});
export type SecretRef = z.infer<typeof secretRefSchema>;

/** mod-vault's well-known service key (duck-typed — never imported). */
export const VAULT_SERVICE_KEY = "vaultService";

export interface VaultLike {
  unlocked(): boolean;
  has(name: string): Promise<boolean>;
  read(name: string): Promise<string>;
}

export function vaultLike(ctx: OpContext): VaultLike | undefined {
  return ctx.services[VAULT_SERVICE_KEY] as VaultLike | undefined;
}

/**
 * Resolve a secret reference from its declared source. Throws a located,
 * actionable error when absent; `label` prefixes it with the calling mod's
 * name ("mod-ai", "mod-email", …) so the user knows which config to fix.
 */
export async function resolveSourced(ctx: OpContext, ref: SecretRef, label = "pattern"): Promise<string> {
  if (ref.source === "env") {
    const v = ctx.env[ref.key];
    if (v) return v;
    throw new Error(`${label}: env var "${ref.key}" is not set.`);
  }
  const vault = vaultLike(ctx);
  if (vault?.unlocked() && (await vault.has(ref.key).catch(() => false))) return vault.read(ref.key);
  throw new Error(
    `${label}: no vault secret "${ref.key}" — add it in admin → System → Secrets (vault must be unlocked).`,
  );
}
