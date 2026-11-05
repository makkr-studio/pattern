Mint an immutable version of a workflow document. Inputs: `slug` (URL
param), `doc` and an optional `note`. The doc goes through the same issue
collector the engine uses: any `error` blocks the save and only `issues`
comes back; warnings ride along with the new `version`
(`{ id, hash, note, author, createdAt }`). The snapshot is stored with
`id: slug` and `source: "file"`, attributed to the signed-in principal.

Saving leaves the live pointer where it is. To put the version into service,
pass `version.id` to `admin.workflow.deploy`. Versions are content-addressed
on behavior: a save that only changes layout, titles or comments returns the
existing version id and refreshes that snapshot's stored body.

Route: `POST /admin/api/workflows/:slug` with `{ doc, note? }`. Scope:
`workflows:write`. This op has two outputs, so failures (a missing `doc`, a
bad slug, a missing scope) surface as errors (HTTP 500). Use
`admin.workflow.validate` for a dry check first. Buddy's
`pattern_save_workflow_draft` wraps this op.
