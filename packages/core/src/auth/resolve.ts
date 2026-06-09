/**
 * Pattern — auth provider chain resolution (§9).
 *
 * Identity is run context, not a boundary. The boundary host runs the provider
 * chain before a run; the first provider to return a principal wins, otherwise
 * the run is anonymous. Per-trigger `requireAuth` is enforced by the host before
 * the graph executes (returning 401 / nonzero exit), never inside the graph.
 */

import type { AuthProviderRegistry } from "../registry.js";
import { ANONYMOUS, type AuthContext, type Principal } from "../types.js";

/** A trigger's optional auth requirement (§9). */
export type AuthRequirement = boolean | { scopes: string[] };

/** Run the provider chain; first non-null principal wins, else anonymous. */
export async function resolvePrincipal(
  registry: AuthProviderRegistry,
  ctx: AuthContext,
): Promise<Principal> {
  for (const provider of registry.chain()) {
    const principal = await provider.authenticate(ctx);
    if (principal) return principal;
  }
  return ANONYMOUS;
}

/** Does `principal` satisfy `requirement`? Returns a reason when it does not. */
export function meetsRequirement(
  principal: Principal,
  requirement: AuthRequirement | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!requirement) return { ok: true };
  if (principal.kind === "anonymous") {
    return { ok: false, reason: "authentication required" };
  }
  if (typeof requirement === "object" && requirement.scopes?.length) {
    const have = new Set(principal.scopes ?? []);
    const missing = requirement.scopes.filter((s) => !have.has(s));
    if (missing.length) {
      return { ok: false, reason: `missing required scope(s): ${missing.join(", ")}` };
    }
  }
  return { ok: true };
}
