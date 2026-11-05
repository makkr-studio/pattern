Structural diff between two saved versions of one workflow, read as `a` → `b`.
Output: `{ equal, nodes: { added, removed, changed }, edges: { added, removed },
meta }`. Nodes match by id and count as changed when their `op`, `config`,
`retry`, `title` or `comment` differ; each `changed` entry carries `before`
and `after`. Edges match on their endpoints. `meta` lists changes to `name`,
`description`, `tags`, `offload` and `durable`.

Pass `ignoreUi=true` to compare behavior only (titles and comments drop out).
Node positions never count. This is the diff the Versions tab shows, and the
thing to read before a deploy or rollback.

Route: `GET /admin/api/workflows/:slug/diff?a=v2&b=v3`. Scope:
`workflows:read`. Either version missing answers 404.
