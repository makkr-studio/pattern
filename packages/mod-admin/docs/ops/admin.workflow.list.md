List every workflow the admin knows, sorted by slug. Stored workflows come
from the workflow store with their real history; every engine-registered
workflow the store doesn't track is added as `source: "code"` with a single
synthetic `code` version. Each entry is catalog meta: `slug`, `name`,
`source`, `enabled`, `live` (the deployed version id, or null), `route`,
`tags`, `internal`, `versions` and the `audit` trail. A code workflow switched
off with `admin.workflow.setEnabled` stays listed with `enabled: false` until
restart.

Framework plumbing (the admin's own endpoint routes, asset mounts) is included
with `internal: true`; filter on it for a user-facing list. This is the data
behind the Workflows room. Open one with `admin.workflow.get`.

Route: `GET /admin/api/workflows`. Scope: `workflows:read`. Every admin HTTP
route carries the mod's `requireAuth` (`{ scopes: ["admin"] }` by default);
the granular scope is re-checked inside the op whenever an auth provider is
installed, which is what lets a scoped API token call admin ops from a tool
workflow such as Buddy's `pattern_*` tools.
