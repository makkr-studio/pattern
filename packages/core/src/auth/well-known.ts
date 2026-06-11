/**
 * §9 — Well-known auth integration points.
 *
 * Cross-mod auth coordination happens through engine services so packages
 * never hard-depend on each other: the identity mod *provides* these services,
 * hosts and the admin mod *consume* them when present. The string keys (and
 * the `user` trigger-port payload) are defined here in core so both sides
 * share one source of truth.
 */

import { z } from "zod";
import type { Principal } from "../types.js";

/**
 * Engine service key under which a login-page URL (string) is advertised.
 * Hosts use it to bounce unauthenticated HTML requests to a login screen
 * instead of a bare 401 (e.g. `/auth/login`).
 */
export const AUTH_LOGIN_URL = "auth.loginUrl";

/**
 * Engine service key under which an identity service is registered (users,
 * sessions, tokens, login methods). The interface lives in the identity mod;
 * consumers that only need presence-detection (e.g. the admin's
 * secure-by-default) never import it.
 */
export const IDENTITY_SERVICE = "identityService";

/**
 * The payload of the `user` output port on trigger boundaries: the resolved
 * principal flattened into something workflows wire edges from — or null when
 * the run is anonymous. Visible identity beats ambient context (§9).
 */
export const userInputSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    email: z.string().optional(),
    name: z.string().optional(),
    scopes: z.array(z.string()),
    claims: z.record(z.string(), z.unknown()),
  })
  .nullable();

export type UserInput = z.infer<typeof userInputSchema>;

/** Flatten a principal into the `user` trigger-port payload (hosts seed this). */
export function principalToUser(p: Principal): UserInput {
  if (p.kind !== "user") return null;
  return {
    id: p.id,
    provider: p.provider,
    email: typeof p.claims?.email === "string" ? p.claims.email : undefined,
    name: typeof p.claims?.name === "string" ? p.claims.name : undefined,
    scopes: p.scopes ?? [],
    claims: p.claims ?? {},
  };
}
