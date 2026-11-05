Make a saved version the live one. Inputs: `slug`, `version` (e.g. `"v3"`)
and an optional `swap`. The version's route is checked against every other
registered workflow (same path and port, overlapping method). On a collision
the op answers `{ ok: false, conflicts: [{ route, conflictsWith }] }` and
changes nothing; with `swap: true` it first disables each conflicting
workflow, then proceeds. Success moves the live pointer, marks the workflow
enabled, registers it under the slug and appends an `activate` audit entry
for the caller: `{ ok: true, version }`.

Rollback is the same call with an older version id. The conflict check reads
the first `boundary.http.request` path or `boundary.http.app` mount in the
doc. A version id that doesn't exist fails the request (HTTP 500).

Route: `POST /admin/api/deploy/:slug` with `{ version, swap? }`. Scope:
`deploy`. That is the split that matters: a `workflows:write` token drafts
and saves, and only a `deploy` token changes what runs. Buddy's
`pattern_deploy_workflow` wraps this op.
