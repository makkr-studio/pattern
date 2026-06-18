# Admin mod — build status & handoff

Where the `mod-admin` work stands against [`mod-admin-spec.md`](../mod-admin-spec.md),
and exactly what's next. Everything below is committed to `main` and **green**
(all packages typecheck + build; `pnpm test` is the source of truth for counts).

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
  kind-colored handles/edges; categorized palette (color+icon per category,
  non-reusable ops in a collapsed Advanced section); drag-connect with
  `api.portsCompatible` assist; schema-driven config forms (raw-JSON toggle with
  invalid-state indicator); node name/comment authoring; **undo/redo (⌘Z/⌘⇧Z)**
  over a canvas snapshot stack; in-editor trigger-aware test runs; template
  picker on "New workflow"; save → version → deploy; validation problems panel.
- **M7 Runs** — list from the sink; span waterfall + I/O peek (T1); live SSE tail
  (connection properly closed on toggle/unmount); **replay-on-canvas** at
  `/runs/:id/replay` — scrubber with play/pause/step/speed, nodes transitioning
  pending→running→ok|error|skipped, edges illuminating as upstream completes;
  metrics strip (`api.metrics`).
- **M8 Versions** — history, structural JSON diff (`api.versions.diff`),
  one-click promote/rollback; delete-workflow with confirm in the catalog.
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
aggregated manifest, declarative pages via `DeclarativeView` (data through each
view's **dedicated route** — the mod ships one purposeful endpoint per screen,
not a generic op invoker), and Tier-2 remotes via a runtime `import()` with React
shared on `window.__PATTERN_ADMIN__`. Proven by `extension.test.ts` + a render
test + live curl checks (manifest aggregation, the data route, the served remote bundle).

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
- **I/O sampling is value-masked.** The engine pools concrete secret *values*
  (schema-tagged + `$env`-resolved) across registered workflows and wires
  `maskSample` into every run, so a token flowing through run *data* is masked in
  span samples — not just in config surfaces. Streams are *marked* not drained.
- **SSE shutdown:** `HttpHost.close()` force-closes lingering sockets so an open
  run-tail stream can't hang shutdown.

## Hardening pass (post-audit)
A four-reviewer audit of the whole repo was triaged and fixed in one pass:
- **Path traversal** closed at the store boundary: `safeSegment()` validates every
  slug / version id / fixture name before it joins a storage path (URL params and
  imported JSON both reach these). `admin.workflow.import` re-checks the id.
- **CORS allowlists** no longer echo a fallback origin: a non-matching request
  origin gets *no* `Access-Control-Allow-Origin` header.
- **`adminMod({ auth })` stamps the SPA workflow** too, not just API routes.
- **Declarative pages bind to dedicated routes** (not a generic invoker): every
  screen/action is its own purposeful route workflow, built by `httpEndpoint` and
  admin-scope-stamped — so the exposed surface is the route table, no ACL needed.
- **Worker pool**: `sampleIo` crosses the seam; crashed workers respawn in place
  (in-flight runs reject, `inflight` resets); `mods: [...]` option loads mod ops
  in workers; error-path runs always post `done`.
- **Hook recursion guard** is per-call-chain — depth is threaded *explicitly*
  (`invoke(name, payload, depth)` → `RunRequest.hookDepth`), so concurrent
  invocations can't trip it spuriously and the guard survives the worker seam
  (core stays runtime-neutral: no `AsyncLocalStorage`).
- **`HttpHost.rebuild()` serialized** (burst workflow changes can't race
  `openServer` into EADDRINUSE); buffered bodies capped (413, default 10 MiB).
- **Store writes per slug are queued** — concurrent saves can't mint duplicate
  version ids; metadata-only saves leave an audit entry.
- **SPA**: deploy/enable/delete invalidate the right query keys; the SSE tail
  closes its connection on toggle/unmount; JSON config fields are controlled with
  a visible invalid state; tooltips flip at the viewport bottom; dialogs have
  roles/Escape/focus handling.

## Boundary pairs + editor UX pass (2026-06-10)

**Engine — boundaries come in pairs (§7).** Every boundary op now names its
canonical partner via `OpDefinition.pair` (trigger ↔ out-gate, no exceptions;
event/schedule/ws.close pair with the generic `boundary.return`).
`boundary.http.app` was redesigned into the trio it always wanted to be:
the **trigger** declares the HTTP side (mount/port/cors/auth, with
mount/port as config-input ports), an **app op** produces the app object
(`core.app.static` generically; `admin.app` is the admin's own SPA as a node),
and the **`boundary.http.app.serve` out-gate** receives it. The HTTP host
resolves each app *by running the workflow once at registration* — the mount is
computed by the graph itself, and that run is visible in the runs list.
Schedule/event/hook triggers also gained config-input ports (cron/intervalMs,
event, hook/priority). `workflow.get` returns `latestDoc` so an undeployed save
reopens on its newest version.

**Editor.** Palette is drag-and-drop (fuzzy search + by-mod filter, scrolls
independently); dropping a boundary op brings its partner, and pairs are
deleted together (`ui.pair` persists the link). Nodes show the implicit control
run ports (run-after on top, run-then on the bottom), config-input ports as
square handles, and data-typed port colors with hover tooltips; connections
refuse incompatible kinds/types live (and the server assist understands
implicit control ports). Edges are fluid beziers, thicken on hover, and glow
when selected. Workflow JSON imports/exports from the toolbar.

**Chrome.** A real Pattern logo (a "P" drawn as a graph, port-colored nodes)
plus a matching SVG favicon; fuzzy search + mod filters on the ops/workflow
catalogs; and a zero-asset WebAudio soundboard across the whole admin (clicks,
connect snaps, add/delete, save chime, deploy arpeggio, run/ok/error, undo/redo,
modals) with a mute toggle in the shell — rises mean creation, falls mean
removal, buzzes mean refusal. All verified live in Chrome.
