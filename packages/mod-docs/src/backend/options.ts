/** @pattern-js/mod-docs — options & defaults. */

export interface DocsModOptions {
  /** Where the docs app mounts (UI + API under here). Default "/docs". */
  mount?: string;
  /** SPA assets dir override (defaults to the bundled dist-app). */
  assets?: string;
  /** Core handbook content dir override (defaults to the packaged docs/). */
  content?: string;
  /**
   * requireAuth for the docs API + content routes. Default
   * `{ env: "DOCS_REQUIRE_AUTH" }` — unset/false → public docs (the point of
   * a standalone app), true → any signed-in user, anything else → scope list.
   * The SPA route itself always stays open; it renders its own sign-in card.
   */
  requireAuth?: unknown;
  /** Where the admin lives, for "open in admin" deep links. Default "/admin". */
  adminMount?: string;
  /** Magic-link request path for the sign-in card. Default "/auth/magic-link/request". */
  loginRequestPath?: string;
  /**
   * Memoize chapter nav / search index / llms.txt per process (content is
   * version-locked, so this is safe). Set false while WRITING docs so nav
   * picks up new files without a restart. Default true.
   */
  cache?: boolean;
}

export interface ResolvedDocsOptions {
  mount: string;
  assets?: string;
  content?: string;
  requireAuth?: unknown;
  adminMount: string;
  loginRequestPath: string;
  cache: boolean;
}

export function resolveOptions(options: DocsModOptions = {}): ResolvedDocsOptions {
  return {
    mount: (options.mount ?? "/docs").replace(/\/$/, "") || "/docs",
    assets: options.assets,
    content: options.content,
    requireAuth: options.requireAuth ?? { env: "DOCS_REQUIRE_AUTH" },
    adminMount: (options.adminMount ?? "/admin").replace(/\/$/, "") || "/admin",
    loginRequestPath: options.loginRequestPath ?? "/auth/magic-link/request",
    cache: options.cache ?? true,
  };
}
