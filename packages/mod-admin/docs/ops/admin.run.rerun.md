Resume or re-run a settled run of a `durable: true` workflow from its
RunLedger record. `from: "failure"` (the default, the Resume button) seeds
every completed node with its recorded outputs and re-executes the failed
frontier onward, keeping the original idempotency lineage. `from: "start"`
(Re-run) replays the recorded trigger input as a fresh run in a new lineage,
so every external effect happens again.

Call it with `dryRun: true` first: `{ ok: true, plan }` lists `reuse`,
`execute` (each with its `effects` stamp), `skipped` and `ambiguous`.
Ambiguous nodes are external-effect nodes that started and never finished, or
failed without a verdict that the effect didn't happen. A real call that
would cross them answers `{ ok: false, blocked, message }` until repeated with
`confirmExternal: true`. Success returns `{ ok: true, runId }` at once; follow
the new run with `admin.run.get`.

Each precondition answers 400 with a message: a ledger is configured, the run
has a record and has settled, its workflow is still registered with the same
structure (roll back to resume across a redeploy), and `from: "failure"` is
not used on a run that succeeded.

Route: `POST /admin/api/runs/:runId/rerun` with
`{ from?, dryRun?, confirmExternal? }`. Scope: `runs:write`.
