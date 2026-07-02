/**
 * @pattern-js/mod-auth-oidc — OIDC login via mod-identity's LoginMethod SPI.
 *
 * Configure it with a small wrapper mod (code-only on purpose — see
 * options.ts):
 *
 * ```js
 * // mods/oidc.mjs
 * import { oidcMod } from "@pattern-js/mod-auth-oidc";
 * export default oidcMod({
 *   providers: [
 *     { id: "google", label: "Continue with Google", issuer: "https://accounts.google.com",
 *       clientId: "…", clientSecret: { source: "env", key: "GOOGLE_CLIENT_SECRET" } },
 *   ],
 * });
 * ```
 *
 * Each provider registers a `kind: "redirect"` login method — the identity
 * login page renders the button and carries `?next=` through the flow. The
 * bare default export (no providers) just prints a configuration hint.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern-js/runtime-node";
import { defineMod, type Engine, type PatternMod } from "@pattern-js/core";
import { IDENTITY_SERVICE, type IdentityService } from "@pattern-js/mod-identity";
import { resolveOptions, type OidcOptions } from "./options.js";
import { OidcRuntime } from "./discovery.js";
import { buildOps } from "./ops.js";
import { oidcRoutes } from "./routes.js";

export { resolveOptions, oidcProviderSchema, oidcOptionsSchema, secretRefSchema } from "./options.js";
export type { OidcOptions, OidcProvider, ResolvedOidcOptions, SecretRef } from "./options.js";
export { OidcRuntime, type DiscoveryDoc } from "./discovery.js";
export { stateCookieName } from "./state.js";

/** The packaged docs/ chapter (the `docs` contribution points at "oidc-docs"). */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "oidc-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function oidcMod(options: OidcOptions = {}): PatternMod {
  const opts = resolveOptions(options);

  // No providers → contribute nothing (also keeps a stray bare listing from
  // colliding with a configured wrapper's op registrations). Docs still mount.
  if (opts.providers.length === 0) {
    return defineMod({
      name: "@pattern-js/mod-auth-oidc",
      docs: { filesystem: "oidc-docs", title: "OIDC login", order: 42 },
      ready: (engine: Engine) => {
        packagedDocs(engine);
        console.error(
          "[pattern] @pattern-js/mod-auth-oidc: no providers configured — wrap it in an app-local mod " +
            "(see the package README) and list that instead.",
        );
      },
    });
  }

  const runtime = new OidcRuntime();
  return defineMod({
    name: "@pattern-js/mod-auth-oidc",
    docs: { filesystem: "oidc-docs", title: "OIDC login", order: 42 },
    ops: buildOps(opts, runtime),
    workflows: oidcRoutes(
      opts.mount,
      opts.providers.map((p) => p.id),
    ),
    // `ready`, not `setup`: the identity service registers in identity's setup,
    // and every setup runs before any ready — order in the config is free.
    ready: (engine: Engine) => {
      packagedDocs(engine);
      const svc = engine.service<IdentityService>(IDENTITY_SERVICE);
      if (!svc) {
        console.error(
          "[pattern] @pattern-js/mod-auth-oidc: identity service not found — add @pattern-js/mod-identity to your mods.",
        );
        return;
      }
      for (const p of opts.providers) {
        svc.registerLoginMethod({
          id: `oidc:${p.id}`,
          label: p.label ?? `Continue with ${p.id}`,
          kind: "redirect",
          startUrl: `${opts.mount}/oidc/${p.id}/start`,
        });
      }
    },
  });
}

/** Bare default (no providers — prints a configuration hint; use `oidcMod({...})`). */
export default oidcMod();
