/**
 * @pattern/mod-vault — the service other mods consume (VAULT_SERVICE).
 *
 * `read` decrypts AND registers the plaintext into the engine's sample-mask
 * pool (via the callback the mod wires in setup) — a vault value can never
 * appear in sampled run I/O, whatever node it later flows through. `list`
 * never returns ciphertext, let alone plaintext.
 */

import { makeVaultCrypto, missingKeyError, type VaultCrypto } from "./crypto.js";
import type { SecretInfo, VaultStore } from "./store.js";

export interface VaultService {
  read(name: string): Promise<string>;
  has(name: string): Promise<boolean>;
  write(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;
  list(): Promise<SecretInfo[]>;
  /** Whether a master key is configured (the admin page shows a setup hint when not). */
  unlocked(): boolean;
}

export class DefaultVaultService implements VaultService {
  private crypto: Promise<VaultCrypto> | undefined;

  constructor(
    private readonly store: VaultStore,
    private readonly masterKey: string | undefined,
    private readonly registerSecret: (value: string) => void,
  ) {}

  unlocked(): boolean {
    return Boolean(this.masterKey);
  }

  private cryptoOrThrow(): Promise<VaultCrypto> {
    if (!this.masterKey) throw missingKeyError();
    this.crypto ??= makeVaultCrypto(this.masterKey);
    return this.crypto;
  }

  async read(name: string): Promise<string> {
    if (!this.masterKey) throw missingKeyError();
    const row = await this.store.get(name);
    if (!row) throw new Error(`vault: no secret named "${name}" — add it on the admin Secrets page`);
    const value = await (await this.cryptoOrThrow()).decrypt(row.ciphertext, row.iv);
    this.registerSecret(value);
    return value;
  }

  async has(name: string): Promise<boolean> {
    return (await this.store.get(name)) != null;
  }

  async write(name: string, value: string): Promise<void> {
    const { ciphertext, iv } = await (await this.cryptoOrThrow()).encrypt(value);
    await this.store.put(name, ciphertext, iv);
    // The plaintext just passed through this process: mask it from samples too.
    this.registerSecret(value);
  }

  async delete(name: string): Promise<boolean> {
    return this.store.delete(name);
  }

  async list(): Promise<SecretInfo[]> {
    return this.store.list();
  }
}
