Decrypt one secret by config `key` and emit it as a secret-typed value. Wire it
into any input that needs the secret, such as an auth header for `core.http.fetch`.
The value registers into the engine's sample mask on read, so it shows as `•••` in
any sampled run I/O. Fails with a setup hint when the vault is locked (no
`PATTERN_VAULT_KEY`) or the secret doesn't exist (admin → System → Secrets).
