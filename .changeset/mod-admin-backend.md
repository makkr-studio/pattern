---
"@pattern/mod-admin": minor
---

Initial `@pattern/mod-admin` — the self-reflecting admin backend (mod-admin-spec M2–M3).

- **ControlPlane + WorkflowStore** (§4, §9): a filesystem-backed
  `FlystorageWorkflowStore` (slug/`_meta.json`/`vN.json`/fixtures); lifecycle
  `save → version → deploy → disable`; route-conflict check on activation
  (cancel/swap); audit trail; boot registers enabled file workflows.
- **Versioning** (§5): content-addressed immutable snapshots (ignoring data-only
  `ui`), one live pointer per slug (instant rollback), and a structural JSON diff.
- **In-memory trace sink** (T4): bounded ring buffer of runs + spans, live span
  tail, and windowed run/error counters + per-workflow latency percentiles.
- **`admin.*` ops** (§10) reaching the control plane / sink / engine via
  `ctx.services` (in-process), with engine introspection (op/mod catalog,
  port-compat, deterministic "explain") — all config redacted (P4).
- **Endpoint workflows** (§11): the admin API is itself workflows
  (`http.request → admin op → http.response`), derived as live routes; plus a
  `boundary.http.app` SPA mount and the admin's own `frontend` contribution.
- `adminMod(options)` factory + default export; install with `engine.useAsync`.
