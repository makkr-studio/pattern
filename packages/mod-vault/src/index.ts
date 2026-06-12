/** @pattern/mod-vault — public surface. */

export { vaultMod } from "./mod.js";
export { default } from "./mod.js";

export { resolveOptions, type VaultOptions, type ResolvedVaultOptions } from "./options.js";
export { VAULT_SERVICE, vaultService } from "./well-known.js";
export { DefaultVaultService, type VaultService } from "./service.js";
export { makeVaultCrypto, missingKeyError, type VaultCrypto } from "./crypto.js";
export { memoryVaultStore, sqliteVaultStore, type SecretInfo, type SecretRow, type VaultStore } from "./store.js";
export { vaultOps } from "./ops.js";
export { vaultFrontend } from "./frontend.js";
