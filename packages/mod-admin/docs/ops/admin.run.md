Run a workflow once and wait for the result: the editor's test button. Body:
a draft `doc` or the `slug` of a registered workflow, plus optional `trigger`
(a trigger node id; defaults to a `boundary.manual` trigger, else the only
trigger), `input` (the trigger's output ports), `params` (read by
`core.input`) and `runId`. The doc is validated first and errors come back as
`{ ok: false, issues }`. A draft goes through the same resolve phase a
registration would (`$env` references, boundary config ports), so it behaves
like its deployed self.

The run executes in-process with I/O sampling on, as the caller's principal,
and is recorded in Runs for replay. Output: `{ ok: true, runId, status,
outputs, error? }`, with `outputs` keyed by node, then port; live streams show
as the string `"[stream]"`. The response arrives only when the run ends, so
pass your own `runId` (8 to 64 letters, digits or dashes) to be able to stop
it with `admin.run.cancel` meanwhile.

Route: `POST /admin/api/run`. Scope: `runs:write`. Saved fixtures
(`admin.fixture.get`) supply `trigger`, `input` and `params`.
