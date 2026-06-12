Reads a run-scoped parameter (`ctx.params`) by name — values passed at
`engine.run(wf, { params })`. Use it for per-run knobs that aren't trigger
payload (feature flags, tenant ids threaded by the host).
