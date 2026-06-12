/** @pattern/mod-vault — options & defaults. */

export interface VaultOptions {
  /** SQLite path, or "memory". Default "./.pattern-data/vault.db". */
  storage?: string;
  /**
   * Master key (base64, 32 bytes). Default: the PATTERN_VAULT_KEY env var.
   * Without one the mod still loads — reads/writes fail with a setup hint.
   */
  masterKey?: string;
}

export interface ResolvedVaultOptions {
  storage: string;
  masterKey: string | undefined;
}

export function resolveOptions(options: VaultOptions = {}): ResolvedVaultOptions {
  return {
    storage: options.storage ?? "./.pattern-data/vault.db",
    masterKey: options.masterKey ?? process.env.PATTERN_VAULT_KEY,
  };
}
