/**
 * @pattern-js/mod-auth-oidc — the per-flow state cookie + PKCE.
 *
 * One short-lived HttpOnly cookie per PROVIDER (`pattern_oidc_<id>`) carries
 * {state, nonce, verifier, next} across the IdP round-trip — per-provider so
 * two concurrent flows can't clobber each other; SameSite=Lax (the host's
 * default) because the IdP redirect back is a top-level GET. The value is
 * unsigned base64url JSON on purpose: the cookie only protects the browser it
 * was set in — a tamperer can only break their OWN login (state/nonce stop
 * replaying it anywhere else), so a signature would add moving parts, not
 * security.
 */

import { createHash, randomBytes } from "node:crypto";

export interface OidcFlowState {
  v: 1;
  state: string;
  nonce: string;
  verifier: string;
  next: string;
}

export const stateCookieName = (providerId: string): string => `pattern_oidc_${providerId}`;

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

/** PKCE S256: challenge = base64url(sha256(verifier)). */
export const pkceChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

export const encodeState = (s: OidcFlowState): string =>
  Buffer.from(JSON.stringify(s), "utf8").toString("base64url");

export function decodeState(raw: unknown): OidcFlowState | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<OidcFlowState>;
    if (
      parsed?.v === 1 &&
      typeof parsed.state === "string" &&
      typeof parsed.nonce === "string" &&
      typeof parsed.verifier === "string" &&
      typeof parsed.next === "string"
    ) {
      return parsed as OidcFlowState;
    }
  } catch {
    /* not ours / corrupted → state mismatch handling upstream */
  }
  return undefined;
}
