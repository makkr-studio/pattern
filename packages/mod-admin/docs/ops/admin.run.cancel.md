Abort a run executing in this process, whatever started it (an HTTP request,
a schedule, the editor, `ctx.invoke`). Output `{ ok }`: `true` when the abort
was delivered, `false` when this process doesn't know the run or it has
already settled. The run ends with status `canceled`.

A run started with `admin.run` returns its id only at the end; choose the
`runId` yourself there to be able to cancel it while it runs.

Route: `POST /admin/api/runs/:runId/cancel`. Scope: `runs:write`.
