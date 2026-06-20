/**
 * @pattern-js/mod-vault — AES-256-GCM via Web Crypto.
 *
 * Master key: 32 random bytes, base64, from the PATTERN_VAULT_KEY env var
 * (generate with `openssl rand -base64 32`). Fresh 96-bit IV per encryption —
 * GCM's one hard rule. The auth tag rides inside the ciphertext blob
 * (subtle.encrypt appends it), so tampering fails decryption loudly.
 */

const b64 = {
  encode: (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)),
  decode: (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

export interface VaultCrypto {
  encrypt(plaintext: string): Promise<{ ciphertext: string; iv: string }>;
  decrypt(ciphertext: string, iv: string): Promise<string>;
}

export function missingKeyError(): Error {
  return new Error(
    "vault: PATTERN_VAULT_KEY is not set. Generate a master key with `openssl rand -base64 32` " +
      "and export it before booting (the vault stores ciphertext only — without the key nothing decrypts).",
  );
}

export async function makeVaultCrypto(masterKeyB64: string): Promise<VaultCrypto> {
  const raw = b64.decode(masterKeyB64.trim());
  if (raw.byteLength !== 32) {
    throw new Error(
      `vault: PATTERN_VAULT_KEY must decode to 32 bytes (got ${raw.byteLength}) — generate with \`openssl rand -base64 32\``,
    );
  }
  const key = await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  return {
    async encrypt(plaintext) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        new TextEncoder().encode(plaintext),
      );
      return { ciphertext: b64.encode(new Uint8Array(ct)), iv: b64.encode(iv) };
    },
    async decrypt(ciphertext, iv) {
      const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b64.decode(iv) as BufferSource },
        key,
        b64.decode(ciphertext) as BufferSource,
      );
      return new TextDecoder().decode(pt);
    },
  };
}
