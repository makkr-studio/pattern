A stored workflow's version history, oldest first:
`[{ id, hash, note?, author?, createdAt }]`. Ids run `v1`, `v2`, … and `hash`
is the behavior hash that dedupes identical saves. A code workflow or an
unknown slug yields `[]`, since only stored workflows have versions.

The live pointer and the audit trail live on the catalog meta
(`admin.workflow.get`). Load a snapshot with `admin.version.get` and compare
two with `admin.version.diff`.

Route: `GET /admin/api/workflows/:slug/versions`. Scope: `workflows:read`.
