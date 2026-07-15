# Admin

`@pattern-js/mod-admin` is the self-reflecting control surface at `/admin`: a
visual editor for the very workflows it is built from. Every admin API route is
itself a Pattern workflow assembled from the same primitives you author with, so
the admin's own control plane shows up in its own catalog and is editable inside
itself.

It is a mod like any other. Install it (`engine.use(adminMod())`), and the SPA
is served through the app boundary alongside the rest of your app.

## What's there

- **Catalog**: every op, mod, and workflow the engine knows. Source badges
  (`code` / `file`), enable toggles, filters; code workflows are read-only but
  forkable into editable copies.
- **Graph editor**: the hero. An `@xyflow/react` canvas with node types
  rendered from each `OpDefinition`'s ports, config forms from the op's Zod
  schema (secret fields redacted), live validation, and connection assist.
  With `@pattern-js/mod-buddy` installed, a **Buddy dock** (the ✦ toolbar
  toggle) drafts workflows in conversation and applies proposals to the open
  canvas as undoable edits — Save and Deploy stay yours.
- **Runs + replay**: trigger a workflow, watch the per-node waterfall, then
  scrub the replay back over the graph as nodes animate pending → running →
  ok / error / skipped. Run I/O is sampled (capped, secrets masked). Retried
  nodes show their `retry` attempts inline in the waterfall; cancelled runs
  wear their own `canceled` badge (0.5).
- **Resume & re-run** (0.5): runs of `durable: true` workflows carry two extra
  buttons on the run detail — **Resume** (failed runs: completed nodes are
  seeded from the RunLedger, only the failed frontier re-executes) and
  **Re-run** (any run: a fresh run with the recorded trigger input). When
  resume would cross an external-effect node that started but never finished,
  a confirm panel lists the ambiguous nodes and waits for a human call.
  Resumed runs link their lineage both ways (“↻ resumed from …”). The gear
  modal's **Durable runs** toggle opts a workflow in; the Inspector's
  **Reliability** group sets a node's retry policy.
- **Versions + diff**: one live version per slug over an immutable history;
  structural JSON diff between any two versions; promote / rollback are
  one-click pointer moves with an audit trail.
- **System map**: derived routes (and conflicts), schedules, hook chains in
  priority order, events, and WebSocket rooms.
- **Metrics**: a rolling aggregate strip fed by the in-memory trace sink.

## Extension surface

Other mods extend the admin through a small, stable, declarative surface that
leaves admin core untouched. The worked reference is
[`@pattern-js/mod-sample`](/sample), the in-repo example mod: a Tier-1 page
**and** a ⌘K command **and** a Tier-2 page, all from one `defineMod`. Everything
below lives under a mod's `frontend` contribution (`FrontendContribution` in
`@pattern-js/core`), except the data sources, which are ordinary workflows
(`httpEndpoint`).

**Tier 1: declarative pages (no build).** A page is *data*, rendered by the
admin's component kit. A `menu` entry contributes a nav item; a `pages` entry
binds a `path` to a `view`:

- `view` kinds: `table`, `form`, `chart`, `json`, `markdown`, `detail`,
  `graph` (embed a workflow), `iframe`.
- A `view` reaches its data through a dedicated `route` (`{ method, path }`)
  authored with `httpEndpoint`, so the page is *wiring over a purposeful
  endpoint*, and self-reflection holds. Sample's `sample.greetings.list` op is
  fronted by the `sample.route.greetings` workflow, which its `table` view reads.
- **Row actions** (`rowActions`) put a per-row button that calls a route (or
  navigates to a page) with args mapped off the row; **table actions**
  (`actions`) are table-level buttons. Both can be `silent` (refresh) or
  `show` (render the result).

**⌘K commands.** A `commands` entry adds an item to the client-side palette
that either calls a `route` (result shown to the operator) or navigates to a
`path`. Sample's `sample.greet` calls the greetings route.

**Settings sections.** A `settings` entry renders a section on System →
Settings from `fields` (toggle / select / text / number), reading current
values from a `route` and POSTing `{ [key]: value }` patches to a
`submitRoute`; both are dedicated endpoints.

**Tier 2: custom React pages (ESM module).** For bespoke UI a mod contributes a
page's ESM source as a string (`pages: [{ path, module }]`) whose default export
is a component. The admin serves that source same-origin as `text/javascript`
and `import()`s it at runtime (add a mod → its page appears, no admin rebuild).
Same-origin keeps it under a plain `script-src 'self'`, so the mod adds no
workflow, asset mount, or CSP relaxation. The module reads shared deps (React,
the typed API client, the glass UI kit, motion, lucide) off the
`window.__PATTERN_ADMIN__` global (typed as `PatternAdminGlobal` in
`@pattern-js/admin-sdk`) so each loads once. Sample's `/x/studio` page is exactly
this.

`@pattern-js/admin-sdk` is the stable surface for both tiers: the typed API
client, theme tokens, the glass UI kit (`GlassPanel`, `NeonButton`, `Table`,
`FormFromSchema`, `JsonView`, `Markdown`, …), and menu/page/command helpers.

See [Internals](internals.md) for the design of record: provenance,
versioning, the control plane, the trace sink, and the self-reflecting API.
