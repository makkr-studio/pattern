Release a run paused with `admin.run.pause`; node scheduling continues where
it stopped. Output `{ ok }`, `false` when this process doesn't know the run
or its transport can't pause.

It acts only on live, paused runs. To continue a failed durable run from its
ledger (the Resume button on the run detail), use `admin.run.rerun` with
`from: "failure"`.

Route: `POST /admin/api/runs/:runId/resume`. Scope: `runs:write`.
