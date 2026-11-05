Windowed run counters for the Metrics page: `{ window, runs, errors,
errorRate, inFlight, runsPerMin, perWorkflow }`, where each `perWorkflow`
entry has `count`, `errors` and latency `p50`, `p95`, `p99` and `maxMs`. Pass
`window` as a number of minutes (`?window=60`); without it the store reports
since-boot figures (`window.sinceBoot: true`).

Everything is computed from the trace store, so workflows excluded in admin
settings and runs past the retention cap don't count. For individual runs,
use `admin.run.list`.

Route: `GET /admin/api/metrics`. Scope: `runs:read`.
