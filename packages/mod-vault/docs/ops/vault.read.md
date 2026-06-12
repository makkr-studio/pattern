Decrypt one secret by config `key` and emit it as a secret-typed value — wire
it into an input like `agents.run`'s `apiKey`. The value registers into the
engine's sample mask on read: it will show as `•••` in any sampled run I/O.
Fails with a setup hint when the vault is locked (no PATTERN_VAULT_KEY) or
the secret doesn't exist (admin → System → Secrets).
