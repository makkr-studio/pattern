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

## Next — the SPA (M4 shell → M10)

The remaining milestones are the React app. The backend + SDK contract it needs
are **done and stable**, so this is greenfield UI work with a fixed API.

**Why it wasn't built here:** it needs the full frontend toolchain (React 19,
Vite 6, `@xyflow/react`, Tailwind v4, Motion, Zustand, TanStack Query) and visual
verification in a browser — neither available in this autonomous session. Shipping
unverified UI would break the "all green" bar. The contract is locked so the UI
can be built and verified interactively.

### Recommended setup
- New source root `packages/mod-admin/src/app/` (already excluded from the
  package `tsconfig`), built by Vite → `packages/mod-admin/dist-app/`, served via
  the existing `boundary.http.app` mount. Point the mod's `assets` option at
  `dist-app` (a `LocalFilesystem`) instead of the placeholder.
- Dev: run the engine (mod-admin loaded) + Vite dev server; proxy
  `/admin/api/*` → the engine port. `pattern dev` can spawn both (§16).
- Stack + layout: §7 / §8 of the spec. Build all data access on
  `@pattern/admin-sdk`'s `createAdminClient()` (don't hand-roll fetch).

### Milestone map (acceptance in §17)
- **M4** App shell — glass nav from `engine.frontend()` / `buildNav`, dark/light,
  deep links, ⌘K (`CommandRegistry`), empty states.
- **M5** Catalog + op browser — render purely from `api.workflows.list()` /
  `api.ops.list()` (proves self-reflection).
- **M6** Graph editor — `@xyflow/react`; nodes rendered from `OpInfo` (ports from
  `inputs`/`outputs`/`controlOut`); edges per kind; config forms from
  `configSchema`; live validation; connection assist via `api.portsCompatible`.
- **M7** Test & Runs — trigger runs; replay over the graph from `api.runs.get`
  spans (+ I/O samples, T1); live tail via `api.runs.tail`; metrics strip from
  `api.metrics`.
- **M8** Versioning UI — history, JSON diff (`api.versions.diff`), promote/rollback.
- **M9** System map — routes (+conflicts), schedules, hooks, events, WS.
- **M10** Tier-2 extension proof — a sample mod adds a Tier-1 page + ⌘K command +
  a Tier-2 ESM-remote page with zero admin-core changes.

## Decisions of record (engine-side)
- **flystorage → `Filesystem` interface.** A small swappable interface
  (`LocalFilesystem`, `MemoryFilesystem` ship) shared by the app boundary and the
  store, instead of a hard flystorage dependency. A flystorage adapter drops in
  behind it unchanged. Keeps core/runtime lightweight (a project value).
- **Env-derived secrets** are tracked by config *path* at registration and masked
  by `redactConfig`; schema-tagged `secret()` fields are masked structurally.
  (Config-port values resolved from `core.env` are a narrower, documented follow-up.)
- **I/O sampling** captures value ports fully; stream ports are *marked* not
  drained (draining would change run behavior). Masking is a pluggable hook.
- **SSE shutdown:** `HttpHost.close()` force-closes lingering sockets so an open
  run-tail stream can't hang shutdown.
