One op's registry entry by type, in the same `OpInfo` shape as an
`admin.op.list` item: ports with JSON Schemas, config schema, boundary and
pair, `effects`, the contributing `mod`, and which registered workflows use
it (`usedByWorkflows`). Ports are resolved against an empty config. An
unknown type answers 404.

Reach for it to answer "where does this op come from and who uses it" before
changing or removing a mod. Usage prose like this page is served separately
by mod-docs.

Route: `GET /admin/api/ops/:type`. Scope: `workflows:read`.
