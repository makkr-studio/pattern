Recent runs from the trace store, newest first with in-flight runs on top.
Query filters: `workflow` (a workflow id), `status` (`ok`, `error`,
`canceled`, `running`, `streaming`) and `limit`. Each summary carries
`runId`, `workflowId`, `trigger`, `principal`, `status`, start and end times,
`durationMs` and `readyMs` (result-ready time; much shorter than
`durationMs` for a streaming run), `spanCount`, `error`, the `parent` run of
an invoked sub-run, and `executor` when it ran off the host loop.

Runs of workflows matching the exclusion regex in admin settings are never
recorded (by default that hides the admin's own `admin.*` API runs), and
retention is capped by the configured capacity; see `admin.settings.get`.
Open one with `admin.run.get`. Buddy's `pattern_list_runs` wraps this op.

Route: `GET /admin/api/runs`. Scope: `runs:read`.
