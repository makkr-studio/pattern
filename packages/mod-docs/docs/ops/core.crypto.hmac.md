HMAC-sign (or verify) bytes/strings with a secret — the webhook-verification
primitive. Wire the secret from `vault.read`, compare against the provider's
signature header with `core.cmp.eq`, gate the workflow with
`core.flow.gate`. Constant-time comparison is on the roadmap; don't build
high-stakes auth on a string compare.
