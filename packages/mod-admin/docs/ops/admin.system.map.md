What the running engine is wired to, derived from every registered workflow:
`routes` (method, path, port, workflow, and `conflict: true` when two share
method, path and port), `apps` (mount, port, workflow, filesystem),
`schedules` (cron or interval), `hooks` (sorted by hook name, then priority,
default 100), `events`, `ws` (WebSocket nodes by kind) and the distinct
`ports` in use. Node config is parsed through each op's schema, so defaults
show up.

Only registered workflows appear: a disabled stored workflow is absent until
it is deployed again. Reach for it to find which workflow serves a path,
which hooks run in what order, or what fires on a schedule. It backs the
Reference → System map page.

Route: `GET /admin/api/system`. Scope: `workflows:read`.
