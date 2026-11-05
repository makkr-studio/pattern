The deploy toggle. `enabled: true` registers the workflow again: a code
workflow parked by an earlier disable comes back from memory; a stored
workflow redeploys its current `live` version through the usual route-conflict
check (a collision answers `{ ok: false, conflicts }`; resolve it with
`admin.workflow.deploy` and `swap`). A stored workflow with no live version is
rejected (400).

`enabled: false` unregisters the workflow, so its routes, schedules and hooks
stop at once. A stored workflow keeps its versions and is marked disabled. A
code workflow is parked in process memory, and its mod registers it again at
the next boot, so a code disable lasts until restart. That keeps the admin
from permanently switching off its own routes. An unknown slug answers 404.

Route: `POST /admin/api/workflows/:slug/enabled` with `{ enabled }`. Scope:
`deploy`.
