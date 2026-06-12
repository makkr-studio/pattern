/**
 * @pattern/mod-vault — the mod.
 *
 * `setup` opens the store, builds the service with the engine's
 * `registerSecretValue` wired in (every decrypted value joins the sample-mask
 * pool before it can flow), and provides VAULT_SERVICE. No master key is not
 * an install error — the Secrets page explains what to set.
 */

import { defineMod, type Engine, type PatternMod } from "@pattern/core";
import { resolveOptions, type VaultOptions } from "./options.js";
import { DefaultVaultService } from "./service.js";
import { vaultOps } from "./ops.js";
import { vaultFrontend } from "./frontend.js";
import { memoryVaultStore, sqliteVaultStore } from "./store.js";
import { VAULT_SERVICE } from "./well-known.js";

export function vaultMod(options: VaultOptions = {}): PatternMod {
  const opts = resolveOptions(options);

  return defineMod({
    name: "@pattern/mod-vault",
    ops: vaultOps,
    frontend: vaultFrontend(),
    setup: async (engine: Engine) => {
      const store = opts.storage === "memory" ? memoryVaultStore() : await sqliteVaultStore(opts.storage);
      const service = new DefaultVaultService(store, opts.masterKey, (v) => engine.registerSecretValue(v));
      engine.provideService(VAULT_SERVICE, service);
      if (!opts.masterKey) {
        console.warn(
          "[pattern/mod-vault] PATTERN_VAULT_KEY is not set — the vault is locked. " +
            "Generate one with `openssl rand -base64 32`.",
        );
      }
    },
  });
}

/** A ready-to-use vault mod with defaults (for `loadMods`/`engine.use`). */
export default vaultMod();
