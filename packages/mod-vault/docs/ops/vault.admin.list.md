The secret inventory for the admin Secrets screen, at
`GET /admin/api/vault/secrets`: one row per secret with `name`, `version`
(bumped on each rotation) and ISO `created` / `updated` dates. It never
returns secret material, and listing works without the master key.

When `PATTERN_VAULT_KEY` is unset, the first row is a setup hint whose
`name` explains how to generate a key and whose other fields are empty
strings. Code that consumes the list should skip that row. Privileged: gate
the trigger with the `admin` scope. Create or rotate with
`vault.admin.write`; decrypt in a workflow with `vault.read`.
