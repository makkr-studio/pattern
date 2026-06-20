/**
 * @pattern-js/mod-identity — CSRF guard (§9).
 *
 * Lives INSIDE the session auth provider: a cross-site state-changing request
 * simply does not authenticate, so a protected write 401s — no token dance,
 * no second cookie. Fetch Metadata (Sec-Fetch-Site) is authoritative where
 * present; the Origin-vs-Host comparison covers older browsers. Requests
 * without either header (curl, server-to-server) are not browser-CSRF-able
 * and pass.
 *
 * GETs are never blocked — the magic-link callback is by nature a cross-site
 * top-level GET, and safe methods must not mutate anyway.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isStateChanging(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/** Should this state-changing request be refused authentication? */
export function isCrossSiteWrite(headers: Headers): boolean {
  const secFetchSite = headers.get("sec-fetch-site");
  if (secFetchSite) {
    return !(secFetchSite === "same-origin" || secFetchSite === "same-site" || secFetchSite === "none");
  }
  const origin = headers.get("origin");
  if (!origin) return false; // non-browser client — not CSRF-able
  try {
    return new URL(origin).host !== headers.get("host");
  } catch {
    return true; // malformed Origin → refuse
  }
}

/** Derive the request method from an AuthContext (HTTP req, WS upgrade, …). */
export function methodOf(raw: unknown): string {
  const m = (raw as { method?: unknown } | null | undefined)?.method;
  return typeof m === "string" ? m : "GET";
}
