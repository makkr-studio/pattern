Pause a run in flight: no new node starts, and nodes already executing
finish. Output `{ ok }`: `false` when the run is unknown here, already
settled, or on a transport that can't pause (a worker pool has no pause
channel). `admin.run.get` reports `paused`; release it with
`admin.run.resume`.

This is flow control for a live run held in memory. Picking up a failed
durable run from its recorded state is `admin.run.rerun`.

Route: `POST /admin/api/runs/:runId/pause`. Scope: `runs:write`.
