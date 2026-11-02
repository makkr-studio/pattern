Create or update a model alias, matched by `name`. Wire `provider`, `modelId`
and optionally `modality` (default `language`), `secrets` (field name →
`{ source: "vault" | "env", key }`) and `options` (plain strings such as
`resourceName` or `region`). Returns `{ ok, name }`.

A partial write keeps what the alias already has: leave `secrets` or `options`
unwired and the stored ones stay; wire an explicit `{}` to clear them. Saving
the same body twice converges on the same record. The change applies to the
next model build, so every workflow using the alias picks it up without a
restart.

Privileged, served at `POST /admin/api/ai/aliases` behind the admin scope. Run
`ai.alias.test` on the same fields first to catch a missing secret or package.
