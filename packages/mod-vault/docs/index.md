# Vault

`@pattern/mod-vault` stores secrets **encrypted at rest** (AES-256-GCM) and
keeps them out of your observability: any value read from the vault is
registered with the engine's sample mask, so it can never appear in sampled
run I/O.

```jsonc
{ "mods": ["@pattern/mod-vault"] }
```

## The master key

```sh
openssl rand -base64 32        # generate ONCE
# .env (gitignored, auto-loaded):
PATTERN_VAULT_KEY=…
```

The same key forever — it decrypts `.pattern-data/vault.db`. Without it the
vault loads *locked*: nothing breaks at boot, reads fail with a setup hint.

## Using secrets

- **Write** them on the admin's **System → Secrets** page (write-only — values
  are never displayed back).
- **Read** them in a workflow with `vault.read` (config `{ key }` → a
  secret-typed `value` output you wire into e.g. an `apiKey` input).
- **Or don't wire anything**: `agents.run` automatically falls back to a vault
  secret named `OPENAI_API_KEY` when no key is wired or in the environment.
