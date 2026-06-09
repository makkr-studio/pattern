# mod-admin — Specification

**Status:** Build-ready, self-contained. This is the single spec for implementing `@pattern/mod-admin` and `@pattern/admin-sdk`. It assumes the Pattern engine (`@pattern/core` + `@pattern/runtime-node`, v0.1.x) already exists; the contracts here are authoritative for the admin work.

`mod-admin` is a **mod** that adds an authorable, self-reflecting control surface to a Pattern engine: graph-based workflow authoring, live deploy, run inspection, versioning, and a catalog of everything in the system — built to be *extended* by other mods.

---

## 1. Principles

1. **The admin is a mod.** A brick you `engine.use()`. No privileged position.
2. **Total self-reflection.** Every admin endpoint is a Pattern workflow; every capability is an op or an internal service. The framework exposes **no bespoke API surface** — the admin's own backend is authored in the same primitives it edits, and is therefore visible and editable inside itself.
3. **The admin UI is served through the app boundary**, like any other app.
4. **Extensibility first.** Other mods add pages, menu entries, and categories through a small, stable surface — the adoption lever, so it gets first-class design.
5. **Great UX/DX**, dark/light, **modern glassmorphism** with neon/glow/gradient accents. Stack: React 19 + Tailwind v4 + Motion.dev + `@xyflow/react`.

---

## 2. Engine prerequisites (build these first)

The admin cannot exist as specified without these landing in the engine/runtime/admin first. They are small and generally useful. **P1–P3 and T1 are engine/runtime changes; the rest are admin-side.** T3 adds two data-only document fields.

| # | Need | Spec |
|---|------|------|
| **P1** | App-serving boundary | `boundary.http.app` (runtime-node host). Config `{ mount, filesystem, spaFallback?="index.html", immutableAssets? }`. Serves static files from a flystorage filesystem under `mount`; on miss with `Accept: text/html` serves `spaFallback`; else 404. Self-served by the host; no downstream graph. Reuses existing http host/port resolution. |
| **P2** | Frontend contribution on `PatternMod` | Add `frontend?: FrontendContribution` (`{ assets?, menu?: MenuEntry[], pages?: PageDef[] }`). The admin host aggregates `frontend` across all registered mods. Types in §6/§12. |
| **P3** | Async mod install | `engine.useAsync(mod): Promise<void>` runs the resolve phase for config-port workflows. `use()` stays sync and throws its existing guidance error; `loadMods`/`loadProject` use the async path. |
| **P4** | Secret-safe config | A `secret()` Zod helper (or meta convention) tags fields; any field resolved from `$env`/`core.env` is also tagged. A single `redactConfig(config, schema)` used by `engine.ops`/`formatGraph`/all `admin.*` endpoints replaces tagged values with `"••••"`. The admin never receives raw secret values over its API. |
| **P5** | In-process routing | Admin endpoint workflows and admin-driven test runs execute on the **in-process** transport (mod ops, `ctx.services`, hooks/events are unavailable on the worker pool). |
| **P6** | Admin auth seam | Admin runs **anonymous by default** — no provider ships. Admin mod config `{ auth?: boolean \| { provider?, scopes? } }` (default `false`). When set (and an `AuthProvider` mod is installed), registration stamps `requireAuth` (+ scopes) onto every admin endpoint workflow. One config propagates; no per-endpoint editing. |
| **T1** | Trace I/O sampling (opt-in) | `SpanData.io?: { inputs?, outputs?: Record<port, Sample> }`, `Sample = { kind:"value"; preview } \| { kind:"stream"; head[]; count; truncated }`. Enabled per-run/per-sink; capped (≈4 KB); secret-masked. Off by default. Powers run-replay data peeks; replay still works structurally without it. |
| **T2** | `admin.ports.compatible` op | Wraps the engine's existing compatibility check: `(from, to: PortSpec) → { ok; reason?; fix?: "accumulate" \| "emit" }`. Single source of truth for the editor. |
| **T3** | Document fields | Add optional `description: string` to the workflow document, and optional `ui?: { x; y; [k]:unknown }` **per node** (the editor's canvas position, inline so a workflow is one self-contained file). Both data-only; never affect execution. |
| **T4** | Sink aggregates | The admin's in-memory trace sink maintains windowed counters (runs, errors) + a per-workflow latency histogram; exposed via `admin.metrics.summary`. Windows labelled honestly (since-boot / last N min). |

---

## 3. Architecture — how the admin self-reflects

```
   browser ──HTTP──► workflows authored in Pattern (the admin's API):
                       GET  /admin/api/workflows        → admin.workflow.list  → http.response
                       POST /admin/api/workflows/:slug   → admin.workflow.save  → http.response
                       POST /admin/api/deploy/:slug      → admin.workflow.deploy→ http.response
                       GET  /admin/api/ops               → admin.op.list        → http.response
                       GET  /admin/api/runs[/tail]        → admin.run.list/tail  → http.response[/SSE]
                       GET  /admin/*  → boundary.http.app (SPA assets via flystorage, SPA fallback)
                                          │ ops call ctx.services.adminControlPlane
                                          ▼
        ControlPlane (internal service): WorkflowStore (flystorage) · versioning · enable ·
        provenance · route-conflict analysis · audit · introspection passthrough to engine
```

- **Backend = ops + workflows.** The admin contributes control-plane **ops** (`admin.*`, §10) and **workflows** that map `http.request` routes → those ops → `http.response` (§11). That set *is* the admin API; being ordinary workflows, they appear in the catalog and are editable in the admin (the system editing its own control plane).
- **ControlPlane is an internal service, not an API.** Persistence, versioning, and enable-state live behind a `ControlPlane`/`WorkflowStore` interface registered in `setup(engine)`, with **flystorage inside it**. Ops reach it via `ctx.services.adminControlPlane`; introspection (op list, validation) passes through to the engine. The only HTTP surface is workflows; the service is plumbing.
- **Frontend = a mod contribution served by the app boundary.** The admin ships its built SPA as its `frontend` assets; a workflow mounts it via `boundary.http.app`. Other mods' `frontend` manifests merge in at the SDK layer (§6).
- **In-memory trace sink lives in mod-admin** (registered via `engine.onTrace`); only span I/O sampling (T1) is an engine-side change.
- **Storage layout** (flystorage):

```
workflows/
  <slug>/
    _meta.json          # { live, enabled, source, tags, route?, audit[] }
    v1.json v2.json …   # immutable version snapshots (content hash optional)
    fixtures/<name>.json
```

---

## 4. Provenance & lifecycle

Every workflow carries a **source**: `code` (registered by a mod at boot), `file` (loaded from the store), or `db` (future). The catalog badges this; it governs editability:
- **code** — read-only in the editor, fully inspectable, **forkable** (copy → new `file` workflow).
- **file** — the authorable ones.
- **db** — reserved.

Lifecycle:
```
draft (file, not registered)
  → validate (collectIssues — same checks the engine runs)
  → save version (immutable snapshot)
  → activate: route-conflict check → enabled && set live → registerWorkflowAsync(liveVersion)
  → disable: unregisterWorkflow(id)   // definition stays in the store
```

"Enabled/disabled" is **control-plane state**, not an engine concept: enabled-and-live → registered; otherwise stored-but-unregistered. On boot the ControlPlane loads code + file workflows and registers the enabled ones.

**Route-conflict on activation.** Before activating a workflow whose live version declares an HTTP route (method + path), the ControlPlane checks it against all currently-live workflows. On conflict it does **not** auto-resolve: it warns and offers **cancel** or **swap** (disable the conflicting live workflow, activate this one). Also surfaced passively in the System map (§13).

---

## 5. Versioning

Simple road, reconciled with the engine's unique-`id` registry:

- A **logical workflow** has a stable `slug` and an ordered history of **immutable versions** (full JSON snapshot + content hash + notes + author + timestamp).
- **One live version per slug.** Promoting repoints `live` and calls `registerWorkflowAsync` under the slug's stable id → **rollback is instant** (repoint to a prior snapshot; in-flight runs untouched by per-request atomicity). No per-version route auto-generation; side-by-side multi-live is out of scope.

Layered on snapshots + a live pointer: **JSON diff** between any two versions (structural — nodes/edges/config added/removed/changed; no canvas overlay; optional toggle to ignore data-only `ui`/`title`/`comment`); **promote/rollback** as one-click pointer moves with an **audit trail** (who activated which version when, via `Principal`); **drafts & autosave** separate from published versions; **content-addressed dedupe**; **environments later** (named pointers); **compare-with-running** before activating.

---

## 6. Extension surface (the adoption lever)

Two tiers — simple needs cost ~zero, complex needs stay possible.

### Tier 1 — Declarative pages (no build)
A mod declares a page as **data**, rendered by the admin's component kit. Covers settings pages, tables, dashboards, forms.

```ts
{ menu: [{ category: "Observability", label: "My Metrics", icon: "activity", path: "/x/metrics", order: 20 }],
  pages: [{ path: "/x/metrics", view: { kind: "table", source: "mymod.metrics.list", columns: [/*…*/],
                                        actions: [{ label: "Refresh", run: "mymod.metrics.refresh" }] } }] }
```
View kinds: `table`, `form` (Zod→JSON-Schema), `chart`, `json`, `markdown`, `graph` (embed a workflow), `iframe`. Data sources are workflows/ops, so self-reflection holds — a declarative page is wiring, not a new API.

### Tier 2 — Custom React pages (runtime ESM remotes)
For bespoke UIs, a mod ships a built ESM bundle exposing a default-exported component; the admin `import()`s it at runtime (add a mod → its page appears, no admin rebuild).
```ts
{ pages: [{ path: "/x/studio", element: () => import("https://…/mymod-admin.js") }] }
```
**Build-output contract:** the bundle externalizes shared deps (React, `@pattern/admin-sdk`, theme) so they aren't double-loaded — the admin supplies them via an import map and the SDK **pins shared-dep versions**. Iframe (`view: { kind: "iframe" }`) is the escape hatch for fully foreign UIs, not the default.

### `@pattern/admin-sdk`
The stable surface mod UIs import: `useApi()` (typed client over the workflow-backed endpoints), `useTheme()`/tokens, a UI kit (`Table`, `FormFromSchema`, `Chart`, `JsonView`, `GraphView`, `RunTimeline`, `GlassPanel`, `GlowCard`, `NeonButton`), `registerMenu`/`defineDeclarativePage`, `registerCommand` (⌘K). The admin's own pages use this exact surface (dogfooding = proof it's sufficient). Categories are created from the union of `MenuEntry.category`, ordered by `order` then label.

```ts
interface MenuEntry { category: string; label: string; icon?: string; path: string; order?: number;
                      scopes?: string[] /* reserved: unenforced until an auth mod lands */ }
type DeclarativeView =
  | { kind: "table"; source: string; columns: Column[]; actions?: Action[] }
  | { kind: "form"; schema: JsonSchema; submit: string }
  | { kind: "chart"; source: string; spec: ChartSpec }
  | { kind: "json" | "markdown"; source: string }
  | { kind: "graph"; workflow: string }
  | { kind: "iframe"; url: string };
type PageDef =
  | { path: string; view: DeclarativeView }                                    // Tier 1
  | { path: string; element: () => Promise<{ default: React.ComponentType }> }; // Tier 2 (ESM remote)
```

---

## 7. Stack

Locked. Frontend/dev deps live only in `mod-admin`/`admin-sdk`, never in `@pattern/core`. `@pattern/admin-sdk` keeps React as a **peer** dep and ships minimal runtime deps.

| Concern | Choice | Role |
|---------|--------|------|
| Language | TypeScript (strict) | Everything |
| UI | React 19 | The admin SPA |
| Build/dev | Vite 6 | SPA bundling + dev server |
| Styling | Tailwind v4 (`@theme` tokens) | Utilities + glass/neon design tokens |
| Animation | Motion.dev (`motion/react`) | Transitions, edge-flow, run-replay, micro-interactions |
| Graph | `@xyflow/react` 12 | Authoring canvas |
| Client state | Zustand 5 | Editor/canvas state, undo stack, prefs |
| Server state | TanStack Query 5 | Cache/fetch over workflow-backed endpoints |
| Routing | React Router 7 | Deep links |
| Forms | react-hook-form + custom `FormFromSchema` | Config forms from Zod→JSON Schema (not `@rjsf`) |
| Icons | lucide-react | Menu + UI icons |
| Validation | Zod v4 | Shared with engine; `z.toJSONSchema()` for forms |
| Lint/format | Biome | Repo-wide (per engine spec) |

---

## 8. Packages & layout

Two new pnpm-workspace packages (changesets for versioning, Biome repo-wide).

```
packages/
  admin-sdk/                 # @pattern/admin-sdk — extension surface for mods (peerDeps: react)
    src/ api.ts theme.ts menu.ts pages.ts commands.ts components/ index.ts
  mod-admin/                 # @pattern/mod-admin
    src/
      backend/
        control-plane/ store.ts control-plane.ts versioning.ts
        trace/ memory-sink.ts          # ring buffer + rolling aggregates (T4)
        ops/                            # admin.* OpDefinitions (§10)
        workflows/                      # endpoint workflow docs (§11)
        services.ts                     # registers adminControlPlane + traceSink
        mod.ts                          # PatternMod default export
      app/  main.tsx router.tsx shell/ pages/ editor/ theme/
      app.vite.config.ts
    dist-app/                # built SPA → served by boundary.http.app
```

---

## 9. Control-plane contracts

```ts
type Source = "code" | "file" | "db";
type VersionId = string;

interface WorkflowMeta {
  slug: string; name: string; description?: string;
  source: Source; enabled: boolean; live: VersionId | null;
  route?: { method: string; path: string };
  tags?: string[]; versions: VersionInfo[]; audit: AuditEntry[];   // { at, principal, action, version }
}
interface VersionInfo { id: VersionId; hash: string; note?: string; author?: string; createdAt: string }
interface Fixture { trigger?: string; input?: unknown; params?: unknown; principal?: unknown }

interface WorkflowStore {                       // flystorage-backed; DB later
  list(): Promise<WorkflowMeta[]>;
  getMeta(slug: string): Promise<WorkflowMeta | null>;
  getVersion(slug: string, v: VersionId): Promise<WorkflowDoc | null>;
  saveVersion(slug: string, doc: WorkflowDoc, info: { note?: string; author?: string }): Promise<VersionInfo>;
  setLive(slug: string, v: VersionId): Promise<void>;
  setEnabled(slug: string, enabled: boolean): Promise<void>;
  delete(slug: string): Promise<void>;
  listFixtures(slug: string): Promise<string[]>;
  getFixture(slug: string, name: string): Promise<Fixture | null>;
  saveFixture(slug: string, name: string, f: Fixture): Promise<void>;
  deleteFixture(slug: string, name: string): Promise<void>;
}

interface ControlPlane {
  store: WorkflowStore;
  bootstrap(): Promise<void>;                  // load code+file; register enabled
  deploy(slug: string, v: VersionId): Promise<DeployResult>;  // route-conflict check → registerWorkflowAsync
  disable(slug: string): Promise<void>;
  routeConflicts(doc: WorkflowDoc): Promise<RouteConflict[]>;
}
type DeployResult = { ok: true } | { ok: false; conflicts: RouteConflict[] };  // UI offers cancel/swap
```
`FlystorageWorkflowStore` implements `WorkflowStore`; the filesystem is registered as an engine service so `boundary.http.app` and the store share it.

---

## 10. Admin op catalog

All are `OpDefinition`s contributed by the mod, reaching the control plane/engine via `ctx.services`, running **in-process** (P5). I/O are value ports (Zod-typed).

| Op | In → Out |
|----|----------|
| `admin.workflow.list` | — → `WorkflowMeta[]` |
| `admin.workflow.get` | `{ slug }` → `{ meta, liveDoc, draftDoc? }` |
| `admin.workflow.save` | `{ slug, doc, note? }` → `{ version }` (validates, mints snapshot) |
| `admin.workflow.import` | `{ json }` → `{ slug, issues }` |
| `admin.workflow.setEnabled` | `{ slug, enabled }` → `{ ok }` |
| `admin.workflow.deploy` | `{ slug, version }` → `DeployResult` |
| `admin.workflow.delete` | `{ slug }` → `{ ok }` |
| `admin.workflow.explain` | `{ slug }` → `{ text }` (deterministic walker) |
| `admin.version.list` / `.get` | `{ slug }` / `{ slug, v }` → `VersionInfo[]` / `WorkflowDoc` |
| `admin.version.diff` | `{ slug, a, b, ignoreUi? }` → `JsonDiff` |
| `admin.op.list` / `.get` | — / `{ type }` → `OpDefinition[]` / `OpDefinition` (config → JSON Schema) |
| `admin.ports.compatible` | `{ from, to }` → `{ ok, reason?, fix? }` (T2) |
| `admin.run.list` / `.get` | `{ workflow?, status?, limit? }` / `{ runId }` → `RunSummary[]` / `{ spans, io? }` |
| `admin.run.tail` | `{ workflow }` → `stream<SpanData>` (wired to `http.response` SSE) |
| `admin.metrics.summary` | `{ window? }` → `MetricsSummary` (T4) |
| `admin.mod.list` | — → `ModInfo[]` |
| `admin.fixture.*` | per `WorkflowStore` fixture methods |
| `admin.template.list` | — → `Template[]` |

---

## 11. Endpoint workflows (the self-reflecting API)

Each admin route is a workflow: `http.request` → admin op → `http.response`. The host derives routes by scanning these. Endpoints carry **no `requireAuth` by default** (anonymous); when admin `auth` is enabled, registration stamps `requireAuth` (+ scopes) onto every endpoint (P6). Example (the rest follow the identical shape):

```jsonc
{ "$schema": "pattern/workflow/v1", "id": "admin.api.workflows.list", "name": "Admin · list workflows",
  "source": "code",
  "nodes": [
    { "id": "in",  "op": "boundary.http.request", "config": { "method": "GET", "path": "/admin/api/workflows" } },
    { "id": "list", "op": "admin.workflow.list" },
    { "id": "out", "op": "boundary.http.response", "config": { "mode": "buffered" } }
  ],
  "edges": [ { "from": { "node": "list", "port": "out" }, "to": { "node": "out", "port": "body" } } ]
}
```
The SPA itself: a workflow with a single `boundary.http.app` node (`mount: "/admin"`, `filesystem: "admin-assets"`, `spaFallback: "index.html"`). Live tail uses `http.response` `mode:"sse"` fed by `admin.run.tail`'s stream output.

---

## 12. Frontend architecture

- **Shell.** Glass nav built from the aggregated menu manifest (categories from the union of `MenuEntry.category`, ordered by `order` then label). Theme provider (dark/light + glass/neon tokens). React Router routes mirror the deep-link scheme (§15.8).
- **Data layer.** TanStack Query hooks over the admin endpoints; `useApi()` is the typed client (typed from the admin op I/O schemas). No hand-rolled fetch in pages.
- **Editor.** `@xyflow/react` canvas; custom **node types rendered from `OpDefinition`** (ports from `inputs`/`outputs`/`controlOut`); custom **edge types per kind** (value = solid, stream = animated flow via Motion, control = dotted/pulse), colored by port-kind tokens; node positions from each node's `ui` block (T3). **Zustand** store holds canvas state + undo/redo command stack + draft autosave. **Config forms** via custom `FormFromSchema` (react-hook-form + `z.toJSONSchema()`), secret fields redacted (P4). **Live validation** calls `collectIssues` → node/port markers + Problems panel + quick-fixes. Connection assist calls `admin.ports.compatible` (T2).
- **Theme.** Tailwind v4 `@theme` tokens + CSS vars for the glass recipe (`--glass-bg`, `--glass-blur`, `--glass-border`, neon ramp). SDK primitives so mod pages match. Don't animate `backdrop-filter`; honor `prefers-reduced-motion`.

---

## 13. Pages (functional)

- **Graph authoring editor (hero).** Palette from `engine.ops.list()` (categories/provenance/version from `OpDefinition`). Drag op → node; typed kind-aware ports/edges; drag-to-connect highlights only compatible ports and explains incompatibilities with one-click adapter insertion; config forms auto-generated; live validation; auto-layout (elk/dagre) for code/imported workflows lacking positions; save → mint version → activate.
- **Test & Runs.** Trigger from the editor (manual input or simulated http/ws/schedule from the trigger schema); runs execute in-process (P5). Run-replay over the graph; live tail (SSE); runs list from the in-memory sink → span waterfall + graph overlay.
- **Workflow catalog.** All workflows; source badge (code/file/db); enable toggle; live-version indicator; trigger-type/tag filters; search; bulk actions; per-row open/versions/runs.
- **Op / node browser.** All ops (base + mod): category, contributing mod, version, ports, config schema, description; "used by N workflows"; doubles as living docs.
- **System map.** Route table (with conflict warnings), listening ports, scheduled timers, hook chains in priority order, event subscriptions, WS rooms.
- **Settings / secrets / mods.** Secrets/env panel (masked, never resolved on screen — P4); mods view (ops/workflows/pages/versions).

---

## 14. Aesthetics & motion

Distinctly modern, **glassmorphism** as the core surface language on a dark (and light) neon-accented stage.
- **Glass surfaces.** Panels, palette, inspectors, menus, modals, ⌘K: frosted — translucent + `backdrop-blur`, faint hairline light border, soft layered shadows, slight saturation boost. Legible depth tiers (canvas → floating panels → modals). Content crisp; only the surface is glass.
- **Theme tokens** (CSS vars) for dark + light, glass recipe parameterized per theme (dark = smoked glass over a deep gradient; light = bright frosted glass over a soft tint). Semantic colors for the three port kinds, consistent editor↔runtime.
- **Neon / glow / gradient** for active/selected/streaming states; glow via layered `box-shadow`/`drop-shadow`; gradient meshes behind the glass so blur refracts something rich.
- **Modern detailing.** Generous radius, fluid spacing, a clean variable sans (Inter/Geist) + mono for code/JSON; restraint so the graph stays the focus.
- **Motion.dev** for page/panel transitions (glass blur-in), node enter/exit, stream-edge flow, run-replay timeline, micro-interactions. Avoid animating `backdrop-filter`; honor `prefers-reduced-motion`.

---

## 15. Feature specs

Shared invariants: every read/write path is a self-reflecting workflow; the frontend uses `@pattern/admin-sdk`; files go through flystorage; secrets are never rendered (P4).

1. **Run-replay & live tail.** *Replay:* reconstruct execution order from span timestamps; scrubber with play/pause/step/speed; nodes transition pending→running→ok|error|skipped; edges illuminate on consume; node inspector shows timing/status/error + I/O samples (T1). *Live tail/follow:* subscribe to the live span stream filtered to a workflow; "follow latest" auto-switches. *Backend:* `admin.run.list/get`, and `admin.run.tail` wired to `http.response` SSE (the tail is itself a Pattern SSE workflow). Reads the in-memory ring-buffer sink.
2. **Command palette (⌘K).** Fuzzy search across workflows, ops, runs, pages, registered commands; grouped, recency-boosted; multi-step actions ("Deploy…" → slug → version). `admin-sdk` `registerCommand`; admin's own actions register the same way. Client-side index; no new backend.
3. **Version diff (JSON).** A/B picker (defaults draft-vs-live or live-vs-previous); structural JSON diff grouped (nodes/edges/config added/removed/changed) above raw diff; toggle to ignore data-only `ui`/`title`/`comment`. `admin.version.list/get/diff`.
4. **Schema-aware connection assist.** On edge-drag, compatible targets glow, incompatible dim; hover explains ("stream→value: insert `accumulate`") with one-click adapter insert + rewire; new-op drop auto-wires if compatible. Authoritative via `admin.ports.compatible` (T2).
5. **Test fixtures.** Save `{ trigger, input, params, principal }` as named fixtures; one-click run; promote a past run's captured input → fixture; edit via trigger-schema form. `admin.fixture.*` → `workflows/<slug>/fixtures/<name>.json`. Not versioned with the workflow (simple).
6. **Templates & subgraph copy-paste.** "New from template" (auth-gated endpoint, SSE stream, hook listener, cron, WS echo) clones JSON → editor; mods contribute templates. Subgraph copy-paste = clipboard JSON; re-id nodes, preserve internal edges, offset `ui`, drop external dangling edges; validate on paste. `admin.template.list`.
7. **Explain this workflow.** Deterministic structural summarizer (default, offline) walks trigger→ops→out-gate from op `title`/`description` + branch structure; optional AI mode (`ai.explain` op, separate mod). Saveable as the workflow `description` (T3). `admin.workflow.explain`.
8. **Deep links.** `/admin/workflows/:slug`, `…/edit?node=:id`, `/admin/runs/:runId?t=:pos`, `/admin/versions/:slug?a=:v&b=:v`, `/admin/ops/:type`, `/admin/system`. Router restores state; copy-link affordance. Relies on stable ids (all stable). No new backend.
9. **Import / export / fork.** Export workflow/version/subgraph JSON; import → validate → new `file` workflow (collision prompt); fork a `code` workflow → editable `file` (records origin in audit). `admin.workflow.import`; export reuses get.
10. **Empty states that teach.** Empty catalog → "create your first workflow" + template picker + short tour; empty runs → how to trigger; empty canvas → drag-an-op hint + op-browser link. Dismissible; honors "don't show tips". Uses templates + existing lists.
11. **Health / metrics strip.** Runs/min, error rate, p95 per workflow, in-flight count; sparklines; drill-down. `admin.metrics.summary` over the sink's rolling aggregates (T4). Label windows honestly.
12. **Keyboard-first editing & undo/redo.** Add-node (palette at cursor), delete, duplicate, connect mode, nudge, align/distribute, select-all, frame-all; undo/redo (⌘Z/⌘⇧Z) over a canvas command stack; editor-local on the draft, autosaved; publishing mints a version. xyflow primitives + our command stack.

---

## 16. Build & dev

- **Build.** `vite build` (root `src/app`) → `dist-app/`; `mod-admin`'s `frontend.assets` → `dist-app/`; the `admin-assets` flystorage filesystem serves it via `boundary.http.app`; hashed filenames → `immutableAssets: true`.
- **Dev.** Run the engine (mod-admin loaded) + Vite dev server concurrently; Vite proxies `/admin/api/*` to the engine's HTTP port; HMR for the SPA. `pattern dev` can spawn both.
- **Scripts (pnpm).** `dev` (engine + vite), `build` (vite + tsc), `test`, `lint` (Biome).

---

## 17. Build order & acceptance

Each milestone is "done" when its acceptance holds.

1. **Engine prereqs (P1–P6, T1–T4).** `boundary.http.app` serves a static dir with SPA fallback; `useAsync` installs a config-port mod; `frontend` aggregation lists a sample mod's menu; `redactConfig` masks a secret in `admin.op.get`; the auth seam toggles `requireAuth` across endpoints.
2. **ControlPlane + WorkflowStore.** save→version→activate→disable round-trips through `FlystorageWorkflowStore`; boot registers enabled workflows; route conflict returns `DeployResult.ok=false` with cancel/swap.
3. **Admin ops + endpoint workflows + in-memory sink.** Every `admin.*` endpoint returns over HTTP; the sink records runs + aggregates.
4. **admin-sdk + app shell.** SPA loads via `boundary.http.app`; nav renders from the manifest; dark/light glass toggles. *(With: deep links, ⌘K, empty states.)*
5. **Catalog + op browser.** Both render purely from live endpoints (proves self-reflection); provenance/version/mod shown.
6. **Graph editor.** Author → save → activate → run end-to-end; live validation + connection assist work. *(With: keyboard/undo, templates & copy-paste.)*
7. **Test & Runs.** Trigger a run; replay animates it over the graph; live tail streams via SSE. *(With: test fixtures, metrics strip.)*
8. **Versioning UI.** History, JSON diff, promote/rollback with audit. *(With: import/export/fork.)*
9. **System map.** Routes (+conflicts), schedules, hooks (priority order), events, WS.
10. **Tier-2 extension proof.** A throwaway sample mod adds a Tier-1 page **and** a ⌘K command **and** a Tier-2 ESM-remote page with zero admin-core changes.

Milestone 10 is the real test of the thesis: if a sample mod extends the admin without touching admin core, the extension surface works.

---

## 18. Decisions of record

1. Admin is a mod; total self-reflection; no bespoke API surface; UI served via `boundary.http.app`.
2. **Tier-2 pages = runtime ESM remotes** (build-output contract externalizes React/SDK/theme; iframe escape hatch only).
3. **Node layout = inline `ui` block per node** (data-only); workflow stays one self-contained file.
4. **Control-plane storage = ControlPlane internal service** with flystorage inside; HTTP surface stays 100% workflows.
5. **Auth = none by default** (anonymous); `requireAuth` seam pre-wired via one admin config for a later auth provider mod.
6. **Permission scopes** kept in SDK types, reserved/unenforced until an auth mod lands.
7. **Versioning:** one live version per slug; no per-version route auto-gen; route conflicts → cancel/swap on activate; version diff is JSON-only.
8. **Provenance** `code|file|db`; enable/disable is control-plane state; code workflows are read-only/forkable.
9. **Stack:** React 19, `@xyflow/react`, Motion.dev, Tailwind v4, React Router, TanStack Query, Zustand, lucide; config forms via custom `FormFromSchema` (not `@rjsf`); Biome repo-wide.
10. **Observability:** admin in-memory ring-buffer sink + rolling aggregates; opt-in trace I/O sampling (T1) for replay; emit-don't-persist (sqlite sink later).
11. **Distribution invariants honored:** ControlPlane/store/sink behind interfaces; serializable definitions, inputs, run context, payloads; admin endpoints run in-process (P5).
