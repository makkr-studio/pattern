# Vault

`@pattern-js/mod-vault` stores secrets **encrypted at rest** (AES-256-GCM) and
keeps them out of your observability: any value read from the vault is
registered with the engine's sample mask, so it can never appear in sampled
run I/O.

```jsonc
{ "mods": ["@pattern-js/mod-vault"] }
```

## When to use / when not: vault vs. plain env vars

A plain env var (a `.env` file next to `pattern.config.json` is auto-loaded) is
fine for local development and for keys you're happy to keep in the process
environment. Reach for the vault when you want secrets that:

- **survive without redeploying**: written through the admin UI at runtime, no
  config edit or restart;
- **stay out of traces**: vault reads are masked to `•••` in every sampled run;
- **live encrypted on disk**, safe from an accidentally committed `.env`.

It holds secrets under one master key for the whole vault; keep non-secret
config in env vars or config.

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

The **same key forever**: it decrypts `./.pattern-data/vault.db`. Without it
the vault loads *locked*: nothing breaks at boot, but reads/writes fail with a
setup hint and the Secrets page shows a warning row. Lose the key and the
ciphertext is unrecoverable, so back it up where you keep other root secrets.

## Rotation

There are two distinct things people mean by "rotation":

- **Rotate a secret's value** (the common case, a leaked or expired API key):
  re-write the same secret name on the **System → Secrets** page (`vault.admin.write`).
  It's write-only and re-encrypts in place; `vault.read` returns the new value
  on the next run. Nothing else changes.
- **Rotate the master key** is heavier: a new `PATTERN_VAULT_KEY` can't decrypt
  secrets sealed with the old one. Re-key by reading each secret out under the
  old key and re-writing it under the new one before swapping the env var.

## Using secrets

- **Write** them on the admin's **System → Secrets** page (write-only: values
  are never displayed back; sampled values everywhere show as `•••`).
- **Read** them in a workflow with `vault.read` (config `{ key }` → a
  secret-typed `value` output you wire where the secret is needed, such as an
  auth header for `core.http.fetch`).
- **Or don't wire anything**: a model wired inline (`ai.model`) finds its
  provider's key by name (e.g. `OPENAI_API_KEY` for OpenAI), checking the
  environment first, then a vault secret of that name.

## Integration

The headline pairing is **mod-ai** (the model provider). Store your provider key
in the vault under the provider's conventional name (`OPENAI_API_KEY` for OpenAI,
`ANTHROPIC_API_KEY` for Anthropic), and a model wired inline (`ai.model`) finds it
with nothing wired: mod-ai checks the environment first, then the unlocked vault.
A model **alias** (admin → **Settings → AI Providers**) can also point a key field
straight at a named vault secret. Either way the key is masked in traces and never
has to live in a `.env`.

For any other secret (say an API key for an outbound `core.http.fetch`), read it
explicitly with `vault.read` (config `{ key }` → a secret-typed `value` you wire
where you need it). The value stays masked in run samples.

Pair with **mod-store** when a record carries credentials: keep the secret in
the vault and only the reference in the document.
