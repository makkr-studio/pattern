One run in full: its `summary` and every node span (with span events and, when
sampling was on, masked I/O samples), which is what replay animates over the
graph. The op adds live state and lineage: `inflight` and `paused` from the
running engine, `children` (sub-runs started through `ctx.invoke`),
`ledgered` (a RunLedger record exists, so `admin.run.rerun` can act on it)
and `resumedFrom` for a resumed run.

An unknown run id answers 200 with a `null` body. Buddy's `pattern_get_run`
wraps this op.

Route: `GET /admin/api/runs/:runId`. Scope: `runs:read`.
