/**
 * @pattern/mod-identity — cookie plumbing.
 *
 * One cookie, handled by hand: HttpOnly always, SameSite=Lax (Strict would
 * drop the cookie on the magic-link's top-level GET redirect back into the
 * app), Path=/, Secure per options.
 */

export interface CookieOptions {
  secure: boolean;
}

/** Parse a Cookie request header into a name → value map. */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

/** Serialize the session cookie (Set-Cookie value). */
export function serializeSessionCookie(
  name: string,
  value: string,
  opts: CookieOptions & { maxAgeSeconds: number },
): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(opts.maxAgeSeconds)}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Serialize an immediate-expiry cookie (logout). */
export function clearSessionCookie(name: string, opts: CookieOptions): string {
  const parts = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}
