A live stream of node spans as the trace store receives them, for watching
runs happen. The optional `workflow` query narrows it to one workflow id. The
output is a stream port; its route wires it straight to an SSE response.

The tail is process-local: it carries only spans this process's trace store
sees, so runs on another instance of the host never show up. For history,
use `admin.run.list` and `admin.run.get`.

Route: `GET /admin/api/runs/tail` (SSE). Scope: `runs:read`.
