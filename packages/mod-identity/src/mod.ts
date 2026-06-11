/**
 * @pattern/mod-identity — the mod (§9).
 *
 * `setup` opens the stores (sqlite at `./.pattern-data/identity.db` by
 * default — gitignored, never `.pattern/`), builds the service and registers
 * it under core's IDENTITY_SERVICE key plus the login URL under
 * AUTH_LOGIN_URL (hosts redirect unauthenticated HTML there). The session
 * AuthProvider and the `identity.deliverToken` hook ride the PatternMod
 * fields; routes are ordinary endpoint workflows.
 *
 * `ready` runs after the whole mod batch: if the user store is empty, it
 * mints a one-time bootstrap token and prints the setup URL to the console —
 * the same single-use-token primitive as login and invites.
 */

import { AUTH_LOGIN_URL, IDENTITY_SERVICE, defineMod, z, type Engine, type PatternMod } from "@pattern/core";
import { resolveOptions, type IdentityOptions } from "./options.js";
import { DefaultIdentityService } from "./service.js";
import { sessionAuthProvider } from "./auth-provider.js";
import { identityOps } from "./ops.js";
import { endpointWorkflows } from "./workflows.js";
import { identityFrontend } from "./frontend.js";
import { memoryIdentityStores } from "./store/memory.js";
import { sqliteIdentityStores } from "./store/sqlite.js";
import { DELIVER_TOKEN_HOOK } from "./deliver.js";

/** Create the identity mod (a configured `PatternMod`). */
export function identityMod(options: IdentityOptions = {}): PatternMod {
  const opts = resolveOptions(options);

  // Created in `setup`; the auth provider closes over it via the thunk so the
  // provider can be declared on the mod before the stores are open.
  let service: DefaultIdentityService | undefined;

  return defineMod({
    name: "@pattern/mod-identity",
    ops: identityOps,
    workflows: endpointWorkflows(opts.mount),
    authProviders: [sessionAuthProvider(() => service)],
    hooks: [
      {
        name: DELIVER_TOKEN_HOOK,
        payload: z
          .object({
            email: z.string(),
            url: z.string(),
            purpose: z.string(),
            delivered: z.boolean(),
          })
          .loose(),
      },
    ],
    frontend: identityFrontend(),
    setup: async (engine: Engine) => {
      const stores =
        opts.storage === "memory" ? memoryIdentityStores() : await sqliteIdentityStores(opts.storage);
      service = new DefaultIdentityService(stores, opts, engine.connections);
      engine.provideService(IDENTITY_SERVICE, service);
      engine.provideService(AUTH_LOGIN_URL, `${opts.mount}/login`);
    },
    ready: async () => {
      if (!service) return;
      // Bootstrap-on-empty: the first admin signs up through a one-time link.
      const count = await service.listUsers().then((u) => u.length);
      if (count > 0) return;
      const issued = await service.issueToken({
        purpose: "bootstrap",
        ttlMs: 24 * 60 * 60 * 1000,
        data: { roles: opts.bootstrapRoles },
      });
      const path = `${opts.mount}/bootstrap?t=${issued.token}`;
      const guess = `http://localhost:${process.env.PORT ?? 3000}${path}`;
      console.log(
        `\n[pattern] ◆ No users yet — create the first admin with this one-time link (valid 24h):\n` +
          `[pattern]   ${guess}\n` +
          `[pattern]   (path: ${path} — adjust host/port if your app serves elsewhere)\n`,
      );
    },
  });
}

/** A ready-to-use identity mod with defaults (for `loadMods`/`engine.use`). */
export default identityMod();
