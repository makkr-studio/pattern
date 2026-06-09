# Admin mod — build status & handoff

Where the `mod-admin` work stands against [`mod-admin-spec.md`](../mod-admin-spec.md),
and exactly what's next. Everything below is committed to `main` and **green**
(114 tests, all 5 packages typecheck + build).

## Done

### Milestone 1 — Engine prerequisites (§2)
All engine/runtime seams the admin needs. See [admin-prereqs.md](./admin-prereqs.md).
P1 `boundary.http.app` · P2 `frontend` aggregation · P3 `useAsync` · P4
`secret()`/`redactConfig` · P5 in-process (default) · P6 `requireAuth` seam ·
T1 trace I/O sampling · T2 `portCompatibility` · T3 doc fields · plus the
extensible `ctx.services` seam and the `Filesystem` abstraction.

### Milestone 2 — ControlPlane + WorkflowStore + versioning (§4, §5, §9)
`@pattern/mod-admin/backend/control-plane`. Filesystem-backed store
(slug/`_meta.json`/`vN.json`/fixtures); lifecycle save→version→deploy→disable;
route-conflict check on activate (cancel/swap); content-addressed snapshots; one
live pointer per slug (instant rollback); structural JSON diff; audit trail; boot
registers enabled file workflows.

### Milestone 3 — Admin ops + endpoint workflows + sink (§10, §11, T4)
The 24 `admin.*` ops; the endpoint workflows that expose them as live HTTP routes
(`http.request → admin op → http.response`), the `boundary.http.app` SPA mount,
and the admin's own `frontend` contribution; the in-memory ring-buffer trace sink
with live tail + windowed metrics. The whole API is self-reflecting: the admin's
backend appears in its own catalog.

### Milestone 4 (core) — `@pattern/admin-sdk` data layer (§6, §12)
The framework-agnostic surface: protocol DTOs, a typed `createAdminClient()` over
every endpoint (incl. the SSE run tail as an async iterable), and the extension
helpers (`buildNav`, `MenuRegistry`, `CommandRegistry`, `defineDeclarativePage`).
Verified end-to-end against the live backend.

### Milestone 4–9 — the SPA (`packages/mod-admin/src/app`)
Built with React 19 + Vite 8 + Tailwind v4 (glass theme) + `@xyflow/react` +
Motion + Zustand + TanStack Query + React Router, on `@pattern/admin-sdk`. Built
to `dist-app/`, served via `boundary.http.app`; `adminMod()` serves the bundle by
default (placeholder until built). Pages:

- **M4 Shell** — glass nav from the UI manifest (`buildNav`), dark/light theme,
  deep links, ⌘K palette, empty states.
- **M5 Catalog + Op browser** — render purely from `api.workflows.list()` /
  `api.ops.list()` (self-reflection); source badges, enable toggle; op ports +
  config schema + usage.
- **M6 Graph editor** — `@xyflow/react`; nodes rendered from `OpInfo` with
  kind-colored handles/edges; palette add; drag-connect with `api.portsCompatible`
  assist; JSON config inspector; save → version → deploy; validation problems panel.
- **M7 Runs** — list from the sink; span waterfall + I/O peek (T1); live SSE tail;
  metrics strip (`api.metrics`).
- **M8 Versions** — history, structural JSON diff (`api.versions.diff`),
  one-click promote/rollback.
- **M9 System map** — routes (+conflict flags), apps, schedules, hooks (priority
  order), events, WS — from `admin.system.map`.

**Verification (no live browser in this environment):** strict app type-check +
`vite build` (2.4k modules) + jsdom render tests mounting every page (incl. the
xyflow editor) against a seeded cache, plus the SDK integration tests that hit the
live backend. Pixel-level visuals still want a real browser pass.

### Milestone 10 — extension proof ✅
`@pattern/mod-sample` extends the admin with **zero admin-core changes**: an op
(`sample.greetings.list`), a **Tier-1** declarative table page, a ⌘K command, a
menu entry, and a **Tier-2** ESM-remote page whose bundle the mod serves itself
via a `boundary.http.app` mount at `/ext`. The SPA renders all of it: nav from the
aggregated manifest, declarative pages via `DeclarativeView` (data through
`admin.invoke`), and Tier-2 remotes via a runtime `import()` with React shared on
`window.__PATTERN_ADMIN__`. Proven by `extension.test.ts` + a render test + live
curl checks (manifest aggregation, `admin.invoke`, the served remote bundle).

### Remaining (polish, not blocking)
- A real browser pass for pixel-level visual polish (needs the Chrome extension
  connected — unavailable in the build environment; verified via jsdom + build instead).
- `pattern dev` spawning engine + Vite together (today: `vite build` → `dist-app`,
  served by the mod; `scripts/serve-dev.mjs` runs a seeded dev instance).

## Decisions of record (engine-side)
- **Storage = flystorage.** `@pattern/runtime-node` uses flystorage's `FileStorage`
  as the storage handle (`localFs(dir)` / `memoryFs()` constructors ship; the
  app boundary + workflow store share it). Swapping in S3 / GCS / Azure later is a
  one-line adapter change with no consumer edits — the reason we went with
  flystorage over a bespoke interface.
- **Env-derived secrets** are tracked by config *path* at registration and masked
  by `redactConfig`; schema-tagged `secret()` fields are masked structurally.
  (Config-port values resolved from `core.env` are a narrower, documented follow-up.)
- **I/O sampling** captures value ports fully; stream ports are *marked* not
  drained (draining would change run behavior). Masking is a pluggable hook.
- **SSE shutdown:** `HttpHost.close()` force-closes lingering sockets so an open
  run-tail stream can't hang shutdown.
