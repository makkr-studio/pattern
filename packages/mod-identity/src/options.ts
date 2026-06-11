/**
 * @pattern/mod-identity — options & defaults.
 *
 * Sensible defaults so `pattern.config.json` can list the mod as a bare
 * string; custom setups use a local wrapper mod exporting `identityMod({...})`
 * (same convention as `adminMod`).
 */

export interface IdentityOptions {
  /** URL prefix for the auth routes (login, token callback, …). Default "/auth". */
  mount?: string;
  /** Session cookie name. Default "pattern_session". */
  cookieName?: string;
  /**
   * SQLite database path, or "memory" for the in-process store. Default
   * "./.pattern-data/identity.db" — gitignored; NEVER `.pattern/`, which is
   * committed workflow storage and must not hold PII.
   */
  storage?: string;
  /**
   * Role → scopes map, compiled onto the principal at session resolution
   * (so edits apply on the next request). Default { admin: ["admin"] }.
   */
  roles?: Record<string, string[]>;
  /** Who may sign themselves up. Default "invite" (admin invites; closed). */
  signup?: "open" | "invite";
  /** Sliding session lifetime in ms. Default 30 days. */
  sessionTtlMs?: number;
  /** Min interval between sliding-touch writes per session. Default 60s. */
  touchThrottleMs?: number;
  /** Single-use token lifetime in ms. Default 15 minutes. */
  tokenTtlMs?: number;
  /**
   * Set the cookie's Secure flag. Default false so http://localhost logins
   * work out of the box — turn it on behind TLS in production.
   */
  cookieSecure?: boolean;
  /** Role(s) granted to the first (bootstrap) user. Default ["admin"]. */
  bootstrapRoles?: string[];
}

export interface ResolvedIdentityOptions {
  mount: string;
  cookieName: string;
  storage: string;
  roles: Record<string, string[]>;
  signup: "open" | "invite";
  sessionTtlMs: number;
  touchThrottleMs: number;
  tokenTtlMs: number;
  cookieSecure: boolean;
  bootstrapRoles: string[];
}

export function resolveOptions(options: IdentityOptions = {}): ResolvedIdentityOptions {
  return {
    mount: (options.mount ?? "/auth").replace(/\/$/, "") || "/auth",
    cookieName: options.cookieName ?? "pattern_session",
    storage: options.storage ?? "./.pattern-data/identity.db",
    roles: options.roles ?? { admin: ["admin"] },
    signup: options.signup ?? "invite",
    sessionTtlMs: options.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000,
    touchThrottleMs: options.touchThrottleMs ?? 60_000,
    tokenTtlMs: options.tokenTtlMs ?? 15 * 60 * 1000,
    cookieSecure: options.cookieSecure ?? false,
    bootstrapRoles: options.bootstrapRoles ?? ["admin"],
  };
}
