# @pattern-js/mod-vault

Encrypted-at-rest secrets for [Pattern](../../README.md): an AES-256-GCM vault
that keeps secrets out of your observability. Any value read from the vault is
registered with the engine's sample mask, so it can never appear in sampled run
I/O.

**Links:** [pattern-js.dev](https://pattern-js.dev) · [npm](https://www.npmjs.com/package/@pattern-js/mod-vault)

```bash
npm install @pattern-js/mod-vault
```

## When to use / when not

A plain env var (a `.env` next to `pattern.config.json` is auto-loaded) is fine
for local dev. Reach for the vault when you want secrets that:

- **survive without redeploying**: written through the admin UI at runtime;
- **stay out of traces**: vault reads are masked to `•••` in sampled runs;
- **live encrypted on disk**, safe from an accidentally committed `.env`.

It holds secrets under one master key for the whole vault; keep non-secret
config in env vars or `pattern.config.json`.

## Config

Defaults are fine for most setups; the one thing you must supply is the master
key.

```jsonc
{ "mods": ["@pattern-js/mod-vault"] }
```

To move the database or pass the key explicitly, export a local wrapper mod:

```ts
import { vaultMod } from "@pattern-js/mod-vault";

export default vaultMod({
  storage: "./.pattern-data/vault.db",      // or "memory"
  masterKey: process.env.PATTERN_VAULT_KEY, // default; usually leave it
});
```

## The master key

```sh
openssl rand -base64 32        # generate ONCE
# .env (gitignored, auto-loaded):
# PATTERN_VAULT_KEY=<the generated value>
```

The **same key forever** decrypts the vault. Without it the vault loads *locked*
(reads/writes fail with a setup hint); lose it and the ciphertext is
unrecoverable, so back it up where you keep other root secrets.

Read secrets in a workflow with `vault.read`; write them on the admin's **System →
Secrets** page. The headline pairing is `@pattern-js/mod-ai`: a model wired inline
resolves its provider's key by name (e.g. a vault secret named `OPENAI_API_KEY`
for OpenAI) with no node wired at all.

Full documentation: the **Vault** chapter at `/docs` (served by
`@pattern-js/mod-docs`), or [the source](docs/index.md).
