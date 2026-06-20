# Vault

`@pattern-js/mod-vault` stores secrets **encrypted at rest** (AES-256-GCM) and
keeps them out of your observability: any value read from the vault is
registered with the engine's sample mask, so it can never appear in sampled
run I/O.

```jsonc
{ "mods": ["@pattern-js/mod-vault"] }
```

## When to use / when not — vault vs. plain env vars

A plain env var (a `.env` file next to `pattern.config.json` is auto-loaded) is
fine for local development and for keys you're happy to keep in the process
environment. Reach for the vault when you want secrets that:

- **survive without redeploying** — written through the admin UI at runtime, no
  config edit or restart;
- **stay out of traces** — vault reads are masked to `•••` in every sampled
  run, env vars are not;
- **live encrypted on disk** rather than in plaintext in a `.env` checked-in by
  accident.

It is **not** a place for non-secret config (use env vars / config), and it is
**not** a multi-key KMS — there's one master key for the whole vault.

## Configure it

Defaults are fine for most setups; the only thing you must supply is the master
key (below). To move the database or pass the key explicitly, export a wrapper
mod calling the factory:

```ts
import { vaultMod } from "@pattern-js/mod-vault";

export default vaultMod({
  storage: "./.pattern-data/vault.db",   // or "memory"
  masterKey: process.env.PATTERN_VAULT_KEY, // default; usually leave it
});
```

## The master key

```sh
openssl rand -base64 32        # generate ONCE
# .env (gitignored, auto-loaded):
PATTERN_VAULT_KEY=…
```

The **same key forever** — it decrypts `./.pattern-data/vault.db`. Without it
the vault loads *locked*: nothing breaks at boot, but reads/writes fail with a
setup hint and the Secrets page shows a warning row. Lose the key and the
ciphertext is unrecoverable, so back it up where you keep other root secrets.

## Rotation

There are two distinct things people mean by "rotation":

- **Rotate a secret's value** (the common case — a leaked or expired API key):
  re-write the same secret name on the **System → Secrets** page (`vault.admin.write`).
  It's write-only and re-encrypts in place; `vault.read` returns the new value
  on the next run. Nothing else changes.
- **Rotate the master key** is heavier: a new `PATTERN_VAULT_KEY` can't decrypt
  secrets sealed with the old one. Re-key by reading each secret out under the
  old key and re-writing it under the new one before swapping the env var.

## Using secrets

- **Write** them on the admin's **System → Secrets** page (write-only — values
  are never displayed back; sampled values everywhere show as `•••`).
- **Read** them in a workflow with `vault.read` (config `{ key }` → a
  secret-typed `value` output you wire into e.g. an `apiKey` input).
- **Or don't wire anything**: `agents.run` automatically falls back to a vault
  secret named `OPENAI_API_KEY` when no key is wired or in the environment.

## Integration

The headline pairing is **mod-agents**: store the provider key in the vault and
wire it in, so the key is masked in traces and never lives in a `.env`.

```workflow
{ "id": "vault.agent.key",
  "name": "Vault · key → agents.run",
  "nodes": [
    { "id": "key",   "op": "vault.read",  "config": { "key": "OPENAI_API_KEY" } },
    { "id": "agent", "op": "agents.run",  "config": { "instructions": "Be helpful." } }
  ],
  "edges": [
    { "from": { "node": "key", "port": "value" }, "to": { "node": "agent", "port": "apiKey" } }
  ] }
```

`agents.run` resolves its key in order: a wired `apiKey` input → the
`OPENAI_API_KEY` env var → a vault secret *named* `OPENAI_API_KEY`. So storing
the key under that exact name makes it work with no node wired at all — the
graph above is the explicit form, useful when the secret has a different name
or you want it visible on the canvas. Either way the value is masked.

Pair with **mod-store** when a record carries credentials: keep the secret in
the vault and the reference (not the plaintext) in the document.
