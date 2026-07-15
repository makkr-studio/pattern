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

/**
 * A trigger's optional auth requirement (§9). The `{ env }` form defers the
 * decision to an environment variable, resolved per request by the host (via
 * `engine.authorize`) — unset/false-y → open, truthy → any authenticated user,
 * anything else → a comma-separated scope list. This keeps a fleet of routes
 * (e.g. every chat workflow) on one operator-controlled switch, and the config
 * stays a transparent reference in the admin instead of a baked value.
 */
export type AuthRequirement = boolean | { scopes: string[] } | { env: string };

const ENV_FALSE = /^(false|0|no|off)$/i;
const ENV_TRUE = /^(true|1|yes|on)$/i;

/**
 * Collapse an `{ env }` requirement to a concrete one against `env`. Other
 * forms pass through untouched.
 */
export function resolveAuthRequirement(
  requirement: AuthRequirement | undefined,
  env: Record<string, string | undefined>,
): boolean | { scopes: string[] } | undefined {
  if (typeof requirement !== "object" || requirement === null || !("env" in requirement)) {
    return requirement;
  }
  const raw = env[requirement.env]?.trim();
  if (!raw || ENV_FALSE.test(raw)) return undefined;
  if (ENV_TRUE.test(raw)) return true;
  const scopes = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return scopes.length ? { scopes } : true;
}

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
  // An unresolved `{ env }` form reaching here acts as plain `true` (fail
  // closed for anonymous above, no scope demands) — `engine.authorize`
  // resolves it before delegating, so this is only a defensive path.
  if (typeof requirement === "object" && "scopes" in requirement && requirement.scopes?.length) {
    const have = new Set(principal.scopes ?? []);
    // `admin` is the root scope: it satisfies any requirement, so an admin
    // session never needs the granular scopes minted for API tokens.
    if (have.has("admin")) return { ok: true };
    const missing = requirement.scopes.filter((s) => !have.has(s));
    if (missing.length) {
      return { ok: false, reason: `missing required scope(s): ${missing.join(", ")}` };
    }
  }
  return { ok: true };
}
