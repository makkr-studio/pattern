---
title: Internals
order: 80
---

# Admin internals

How `@pattern/mod-admin` and `@pattern/admin-sdk` are built — the design of record
for the self-reflecting control surface. The section numbers (§1–§18) are stable
anchors that the source comments reference. For the day-to-day "how do I extend the
admin," start with the [Admin overview](index.md).

## 1. Principles

1. **The admin is a mod.** A brick you `engine.use()`. No privileged position.
2. **Total self-reflection.** Every admin endpoint is a Pattern workflow; every
   capability is an op or an internal service. The framework exposes **no bespoke
   API surface** — the admin's own backend is authored in the same primitives it
   edits, so it appears in its own catalog and is editable inside itself.
3. **The admin UI is served through the app boundary**, like any other app.
4. **Extensibility first.** Other mods add pages, menu entries, and commands
   through a small, stable surface — the adoption lever, so it gets first-class
   design.
5. **Great UX/DX** — dark/light, modern glassmorphism with neon/glow accents. Stack:
   React 19 + Tailwind v4 + Motion.dev + `@xyflow/react`.

## 2. Engine seams the admin uses

The admin rests on a handful of small, generally-useful engine/runtime seams:

| Seam | What it provides |
|------|------------------|
| **App-serving boundary** | `boundary.http.app` (runtime-node host): serves static assets from a registered filesystem under `mount`, with SPA fallback. Self-served; no downstream graph. |
| **Frontend contribution** | `frontend?: FrontendContribution` on `PatternMod` (`{ assets?, menu?, pages?, commands?, … }`). The admin aggregates `frontend` across every registered mod. |
| **Async mod install** | `engine.useAsync(mod)` runs the resolve phase for config-port workflows; `loadMods`/`loadProject` use it. |
| **Secret-safe config** | a `secret()` Zod tag + `redactConfig`; any field resolved from the vault/env is masked to `••••` before it crosses the admin API. |
| **In-process routing** | admin endpoint workflows and admin-driven test runs execute on the in-process transport (mod ops, `ctx.services`, hooks/events aren't available on the worker pool). |
| **Admin auth seam** | the admin runs anonymous by default; one admin config `{ auth }` stamps `requireAuth` (+ scopes) onto every admin endpoint when an `AuthProvider` mod is installed. |
| **Trace I/O sampling** | opt-in, capped, secret-masked span I/O that powers run-replay data peeks. |
| **Doc fields** | optional `description` on the workflow and `ui?: { x; y }` per node (the canvas position, inline so a workflow is one self-contained file) — both data-only, never affecting execution. |

## 3. Architecture — how the admin self-reflects

```
browser ──HTTP──► workflows authored in Pattern (the admin's API):
   GET  /admin/api/workflows      → admin.workflow.list   → http.response
   POST /admin/api/workflows/:slug → admin.workflow.save   → http.response
   POST /admin/api/deploy/:slug    → admin.workflow.deploy → http.response
   GET  /admin/api/ops             → admin.op.list         → http.response
   GET  /admin/api/runs[/tail]      → admin.run.list/tail   → http.response[/SSE]
   GET  /admin/*  → boundary.http.app (SPA assets, SPA fallback)
                       │ ops call ctx.services.adminControlPlane
                       ▼
   ControlPlane (internal service): WorkflowStore · versioning · enable ·
   provenance · route-conflict analysis · audit · engine introspection
```

- **Backend = ops + workflows.** The admin contributes control-plane **ops**
  (`admin.*`, §10) and **endpoint workflows** that map `http.request` → those ops →
  `http.response` (§11). That set *is* the admin API; being ordinary workflows, they
  appear in the catalog and are editable in the admin.
- **ControlPlane is an internal service, not an API.** Persistence, versioning, and
  enable-state live behind a `ControlPlane`/`WorkflowStore` interface registered in
  `setup(engine)`, with a filesystem inside it. Ops reach it via
  `ctx.services.adminControlPlane`; the only HTTP surface is the workflows.
- **Frontend = a mod contribution served by the app boundary.** The admin ships its
  built SPA as its `frontend` assets; a workflow mounts it via `boundary.http.app`.
  Other mods' `frontend` manifests merge in at the SDK layer (§6).
- **In-memory trace sink lives in mod-admin** (registered via `engine.onTrace`),
  feeding the runs list, waterfalls, replay, and the metrics strip.

## 4. Provenance & lifecycle

Every workflow carries a **source**: `code` (registered by a mod at boot), `file`
(loaded from the store), or `db` (reserved). It governs editability:

- **code** — read-only in the editor, fully inspectable, **forkable** (copy → a new
  `file` workflow).
- **file** — the authorable ones.

Lifecycle: `draft → validate (collectIssues, the same checks the engine runs) →
save version (immutable snapshot) → activate (route-conflict check → enabled & live
→ registerWorkflowAsync) → disable (unregister; the definition stays in the store)`.
"Enabled/disabled" is **control-plane state**, not an engine concept. On a route
conflict at activation the admin does **not** auto-resolve — it offers **cancel** or
**swap** (disable the conflicting live workflow, activate this one).

## 5. Versioning

A **logical workflow** has a stable `slug` and an ordered history of **immutable
versions** (full JSON snapshot + content hash + note + author + timestamp). There is
**one live version per slug**: promoting repoints `live` and re-registers under the
slug's stable id, so **rollback is instant** (repoint to a prior snapshot;
in-flight runs are untouched). On top of snapshots + a live pointer: structural
**JSON diff** between any two versions (optionally ignoring data-only
`ui`/`title`/`comment`), promote/rollback as one-click pointer moves with an
**audit trail**, drafts/autosave separate from published versions, and
content-addressed dedupe.

## 6. Extension surface (the adoption lever)

Two tiers — simple needs cost ~zero, complex needs stay possible.

**Tier 1 — declarative pages (no build).** A mod declares a page as *data*, rendered
by the admin's component kit: `view` kinds `table`, `form`, `chart`, `json`,
`markdown`, `graph` (embed a workflow), `iframe`. Data sources are workflows/ops, so
self-reflection holds — a declarative page is wiring, not a new API.

```ts
{ menu: [{ category: "Observability", label: "My Metrics", icon: "activity", path: "/x/metrics", order: 20 }],
  pages: [{ path: "/x/metrics", view: { kind: "table", route: { method: "GET", path: "/admin/api/mymod/metrics" },
                                        columns: [/* … */] } }] }
```

**Tier 2 — custom React pages (runtime ESM remotes).** For bespoke UIs a mod ships a
built ESM bundle exposing a default-exported component; the admin `import()`s it at
runtime (add a mod → its page appears, no admin rebuild). The bundle reads shared
deps (React, the typed API client, the UI kit) off the `__PATTERN_ADMIN__` global so
they aren't double-loaded; `@pattern/admin-sdk` types that global as
`PatternAdminGlobal`. See [`@pattern/mod-sample`](/docs/sample) for the working proof
— a Tier-1 page **and** a ⌘K command **and** a Tier-2 remote with zero admin-core
changes.

**`@pattern/admin-sdk`** is the stable surface: the typed API client, theme tokens, a
glass UI kit (`GlassPanel`, `NeonButton`, `Table`, `FormFromSchema`, `JsonView`,
`Markdown`, …), and menu/page/command helpers. The admin's own pages use this exact
surface — dogfooding is the proof it's sufficient.

## 7. Stack

Frontend/dev deps live only in `mod-admin`/`admin-sdk`, never in `@pattern/core`;
`admin-sdk` keeps React a **peer** dep. React 19 · Vite · Tailwind v4 (`@theme`
tokens) · Motion.dev · `@xyflow/react` 12 (the authoring canvas) · Zustand (canvas
state + undo) · TanStack Query (server state) · React Router · a custom
`FormFromSchema` (react-hook-form + `z.toJSONSchema()`) · lucide-react · Zod v4.

## 8. Packages & layout

`@pattern/admin-sdk` (the extension surface; peerDep React) and `@pattern/mod-admin`
(backend `control-plane/`, `trace/`, `ops/`, `workflows/`, `services.ts`, `mod.ts`;
frontend `app/` with `shell/`, `pages/`, `editor/`, `theme/`; built SPA → `dist-app/`
served by `boundary.http.app`).

## 9. Control-plane contracts

`Source = "code" | "file" | "db"`. `WorkflowStore` (filesystem-backed) handles
`list/getMeta/getVersion/saveVersion/setLive/setEnabled/delete` plus fixtures;
`ControlPlane` adds `bootstrap()` (load code+file, register enabled),
`deploy(slug, v)` (route-conflict check → `registerWorkflowAsync`), `disable(slug)`,
and `routeConflicts(doc)`. The filesystem is registered as an engine service so
`boundary.http.app` and the store share it.

## 10. Admin op catalog

All `admin.*` ops are contributed by the mod, reach the control plane/engine via
`ctx.services`, run in-process, and use Zod-typed value ports: `workflow.list/get/
save/import/setEnabled/deploy/delete/explain`, `version.list/get/diff`,
`op.list/get`, `ports.compatible`, `run.list/get/tail` (the tail is a stream wired to
`http.response` SSE), `metrics.summary`, `mod.list`, `fixture.*`, `template.list`.

## 11. Endpoint workflows (the self-reflecting API)

Each admin route is a workflow: `http.request → admin op → http.response`. The host
derives routes by scanning these. Endpoints carry no `requireAuth` by default; when
admin `auth` is enabled, registration stamps it onto every endpoint. The SPA itself
is a workflow with a single `boundary.http.app` node (`mount: "/admin"`,
`spaFallback: "index.html"`).

## 12. Frontend architecture

A glass **shell** built from the aggregated menu manifest; a **data layer** of
TanStack Query hooks over a typed client (no hand-rolled fetch in pages); the
**editor** — an `@xyflow/react` canvas with node types rendered from each
`OpDefinition` (ports from `inputs`/`outputs`/`controlOut`) and edge types per kind
(value solid, stream animated, control dotted/pulse), node positions from each node's
`ui` block, a Zustand store with an undo/redo command stack, config forms via
`FormFromSchema` with secret fields redacted, live validation via `collectIssues`,
and connection assist via `admin.ports.compatible`.

## 13. Pages

Graph authoring editor (the hero) · Test & Runs (trigger, replay over the graph, live
SSE tail) · Workflow catalog (source badges, enable toggles, filters) · Op/node
browser (living docs) · System map (routes + conflicts, schedules, hook chains in
priority order, events, WS rooms) · Settings/secrets/mods.

## 14. Aesthetics & motion

Glassmorphism as the core surface language on a dark (and light) neon-accented stage:
frosted translucent panels with hairline borders and layered shadows, theme tokens
(CSS vars) per theme, neon/glow for active/selected/streaming states, Motion.dev for
transitions and the stream-edge flow. Content stays crisp; only the surface is glass.
Don't animate `backdrop-filter`; honor `prefers-reduced-motion`.

## 15. Feature notes

Run-replay reconstructs execution order from the span event log and animates nodes
pending→running→ok|error|skipped with a scrubber; ⌘K is a client-side fuzzy index
over workflows/ops/runs/pages/commands; version diff is structural JSON; connection
assist explains incompatibilities and one-click-inserts an adapter; test fixtures save
`{ trigger, input, params, principal }`; templates clone JSON into the editor; "explain
this workflow" is a deterministic structural walker; deep links restore editor/run
state from stable ids.

## 16. Build & dev

`vite build` (`src/app`) → `dist-app/`, served via the `admin-assets` filesystem and
`boundary.http.app` (hashed filenames → immutable assets). In dev, run the engine
(mod-admin loaded) + the Vite dev server concurrently with Vite proxying
`/admin/api/*` to the engine; `pattern dev` can spawn both.

## 18. Decisions of record

1. Admin is a mod; total self-reflection; no bespoke API surface; UI served via
   `boundary.http.app`.
2. **Tier-2 pages are runtime ESM remotes** — shared deps off `__PATTERN_ADMIN__`,
   never double-bundled; iframe is the escape hatch only.
3. **Node layout is an inline `ui` block per node** (data-only); the workflow stays
   one self-contained file.
4. **Control-plane storage is an internal service** with a filesystem inside; the
   HTTP surface stays 100% workflows.
5. **Auth is none by default** (anonymous); a `requireAuth` seam is pre-wired via one
   admin config for an auth-provider mod.
6. **Versioning:** one live version per slug; route conflicts → cancel/swap on
   activate; version diff is JSON-only; rollback is a pointer move.
7. **Provenance** `code|file|db`; enable/disable is control-plane state; code
   workflows are read-only/forkable.
8. **Observability:** in-memory ring-buffer sink + rolling aggregates; opt-in trace
   I/O sampling for replay; durable persistence via the runtime's trace stores.
9. **Distribution invariants honored:** ControlPlane/store/sink behind interfaces;
   admin endpoints run in-process.
