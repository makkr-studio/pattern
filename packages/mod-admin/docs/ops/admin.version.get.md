Load one snapshot: the full workflow document saved as version `v` of
`slug`, stored with `id: slug`. Use it to inspect or export an older version,
or to look at what a rollback through `admin.workflow.deploy` would bring
back. An unknown slug or version answers 404.

A version's behavior never changes. Its layout, titles and comments can: a
later save with the same behavior hash refreshes them in place.

Route: `GET /admin/api/workflows/:slug/versions/:v`. Scope: `workflows:read`.
