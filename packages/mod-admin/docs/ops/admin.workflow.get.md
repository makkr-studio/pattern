Load one workflow for editing. Returns `{ meta, liveDoc, latestDoc,
safeConfigs }`: the catalog meta, the deployed document, the newest saved
version (what the editor reopens when a version was saved but never
deployed), and, for a registered workflow, each node's config with secret
fields redacted. For a code workflow both docs are the registered document.

An unknown slug answers 200 with `meta: null` and null docs, so check `meta`
before using the result. Buddy's `pattern_get_workflow` tool wraps this op.
For one specific snapshot use `admin.version.get`.

Route: `GET /admin/api/workflows/:slug`. Scope: `workflows:read`.
