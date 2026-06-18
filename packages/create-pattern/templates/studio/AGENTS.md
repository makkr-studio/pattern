# Agent guide — {{name}} (Pattern · studio modpack)

You are working in a **Pattern** project: a workflow engine where logic lives in
**workflows** (JSON graphs of typed ops) and code lives in **ops** (plain
functions contributed by mods). This project also runs `@pattern/mod-admin` — a
visual control plane at `/admin` that edits, versions, runs, and observes those
workflows. Your job is usually one of: add an op, add a route/workflow, or
extend the admin. Recipes for each are below.

## Ground rules

1. **Never guess op names or ports.** Ground truth is one command away:
   - `npx pattern ops` — every available op (core + this project's mods)
   - `npx pattern ops core.string` — filter by prefix
   - `npx pattern ops core.string.template` — full ports + config detail
2. **Validate every workflow JSON you touch:** `npx pattern validate <file>`,
   and `npx pattern graph <file>` to see the graph in the terminal.
3. `npm run dev` hot-reloads on file changes (workflows and mods included).
4. Don't edit `./.pattern` by hand — it's the admin's versioned workflow store
   (treat it like a database; commit it, don't rewrite it).

## Mental model (60 seconds)

- An **op** is a reusable definition: type id, typed input/output **ports**, a
  config schema, an `execute`. A **node** is an op instance in a workflow with
  its own `config`. **Edges** connect output ports to input ports.
- Ports have a kind — `value`, `stream`, or `control` — and only same-kind
  ports connect. Edge kind is derived, never declared:
  - value→value is a **barrier** (consumer awaits the value),
  - stream→stream is **concurrent** with backpressure,
  - control→control is a dataless sequencing pulse.
  To cross value↔stream insert an adapter: `core.stream.accumulate`
  (stream→value) or `core.stream.emit` (value→stream).
- Every op implicitly has control ports `in` and `out` (wiring optional; a node
  with wired control-ins waits for **all** of them). Control-flow ops
  (`core.flow.branch`, `core.flow.switch`) pulse **named** control-outs
  selectively; the untaken side is skipped and the skip propagates.
- **Boundaries** connect a graph to the world, usually a **trigger** (no graph
  inputs; its outputs are the external input) paired with an **out-gate** (its
  resolved inputs are the external result). One run = one trigger firing; only
  that trigger's reachable subgraph executes.

## Workflow JSON anatomy

```jsonc
{
  "$schema": "pattern/workflow/v1",
  "id": "my-flow",                       // slug; unique
  "name": "Human title",
  "description": "Shows in the admin catalog.",
  "nodes": [
    {
      "id": "in",                        // unique within the workflow
      "op": "boundary.http.request",     // an op type — verify with `npx pattern ops`
      "title": "Short label",            // optional, shown on the canvas
      "comment": "Markdown note shown in the editor.",
      "config": { "method": "GET", "path": "/things/:id" },
      "ui": { "x": 40, "y": 120 }        // canvas position; keep ~300px x-steps
    }
  ],
  "edges": [
    { "from": { "node": "in", "port": "params" }, "to": { "node": "next", "port": "data" } }
  ]
}
```

Config values support **env interpolation**, resolved at registration:
`"port": { "$env": "API_PORT", "type": "number", "default": 3001 }` or string
forms `"${API_KEY}"` / `"${REGION:-eu}"`.

## Recipe: add an HTTP route

Routes are declared **inside the workflow** — there is no route table. The
`boundary.http.request` trigger's config carries method, `path`
(`:segment` params), optional `port`, `cors`, and JSON-Schema validation for
`body` / `query` / `params` (enforced by the engine; bad input → 400).
Outputs: `method, url, path, headers, query, params, body`. Pair it with
`boundary.http.response` (inputs: `body`, `status`, `headers`).

Two ways to ship it:

- **File-based**: drop the JSON in `workflows/` — registered at boot,
  hot-reloaded under `npm run dev`, listed read-only in the admin. Best for
  routes that belong in git.
- **Admin-authored**: build it in the editor at `/admin` (or POST through the
  admin API) — versioned in `./.pattern`, deployable/rollbackable.

Objects written to `body` serialize as JSON automatically. See the seeded
`hello` and `quote` workflows (admin → Workflows) for canonical shapes —
`src/examples.ts` has their JSON.

**Design discipline** (the shape to aim for): one workflow per action (not a
fat dispatcher); keep ops HTTP-free — the boundary owns validation (400), auth
(`requireAuth` → 401/403; set it with the editor's auth selector or wire it from
`core.env`), and status (200 default). Never check scopes inside an op — that
couples it to HTTP and breaks CLI/cron/internal callers; if an op reads sensitive
data, tag it `sensitivity: "privileged"` and the validator warns when a route
forgets the gate. Decompose inputs to the field with `core.object.get`, but wire
the op's single domain output straight to the response body (`core.object.build`
only for genuine projections). Declare each input schema in **one** place. The
bundled docs (`@pattern/mod-docs` →
`/docs` → *Designing your API*) is the full version.

## Recipe: serve your own frontend

Beyond Tier-2 admin pages (below), a standalone user-facing SPA is **just a
workflow**: register your built assets as a named filesystem in a mod's
`setup` (`provideFilesystem(engine, "my-app", localFs("./app/dist"))`), then
declare the app trio `boundary.http.app` → `core.app.static`
(`filesystem: "my-app"`) → `boundary.http.app.serve`. `filesystem` is the
registered **name**, not a path; the app resolves once at registration (rebuilt
SPA → restart; in dev, run Vite and proxy `/api` + `/auth` to the backend).
The admin SPA you're looking at is exactly this trio.

## Recipe: add an op

Ops live in **mods**. This project has an app-local mod at `mods/quotes.mjs` —
extend it or add a sibling file (then list it in `pattern.config.json` →
`mods`). Minimal contract (plain ESM, no build step):

```js
/** @type {import("@pattern/core").PatternMod} */
export default {
  name: "my-mod",
  ops: [
    {
      type: "app.slugify",                       // namespace your ops "app.*"
      description: "Lowercase + dashes.",        // shows in catalogs — write one
      inputs: { value: { kind: "value", required: true } },
      outputs: { out: { kind: "value" } },
      execute: async (ctx) => ({
        out: String(await ctx.input.value("value")).toLowerCase().replace(/\s+/g, "-"),
      }),
    },
  ],
};
```

`execute` receives `ctx`: `await ctx.input.value("name")` (one await per value
input), `ctx.config` (validated config object), `ctx.signal` (AbortSignal —
respect it in loops/timers). Return `{ portName: value }`. For streams, return
a `ReadableStream` on a `{ kind: "stream" }` port.

TypeScript mods can use the typed helpers from `@pattern/core`
(`pureOp`, `defineOp`, `required`, `value`, `stream`, `z`) — same shape,
Zod-typed ports and config.

**Verify:** `npx pattern ops app.` must list your op. Then wire it in a
workflow and `npx pattern validate` it.

## Recipe: extend the admin

A mod's `frontend` block adds UI to the admin — no admin code changes. See
`mods/quotes.mjs` for a working example (menu + page + command):

Every data view and action binds to a **dedicated route** the mod also ships —
a pure op fronted by `httpEndpoint(...)` (request → op → response). There is no
generic op invoker: name a route, not an op. A `RouteRef` is
`{ method, path }`, where `path` is relative to the admin API mount (e.g.
`/quotes`); `:tokens` are filled from page/row `args`, leftover args become the
query (GET) or JSON body (POST). `mods/quotes.mjs` is a complete worked example.

- **Menu**: `{ category, label, icon, path, order }` — `icon` is a lucide name.
- **Tier-1 page** (no build step): `{ path, view }` where `view` is one of
  `table` (`{ route, columns, actions?, rowActions? }` — `route` reads the rows;
  a `rowAction` `{ label, route, args: { token: "rowKey" }, confirm? }` calls
  `route` with values pulled from the row — or use `path: "/x/mine/:id"` instead
  of `route` to NAVIGATE, tokens filled from `args`), `form`
  (`{ schema, route }` — submits the values to `route`), `chart`, `json`,
  `markdown` (`{ route }`), `detail` (`{ route }` — one object as labeled rows),
  `graph` (`{ workflow }`), `iframe` (`{ url }`). Page paths may carry
  `:params` (filled into each view's route path), and a page may stack
  `views: [{ title?, view }]` — that's how you build a details page.
- **Command** (⌘K palette): `{ id, label, group, route?, path? }` — `route`
  calls a dedicated route and shows its result; `path` navigates.
- **Settings section** (on System → Settings): `{ id, title, description?,
  route, submitRoute, fields }` under the mod's `frontend.settings` — `route`
  returns current values, `submitRoute` receives `{ key: value }` patches,
  fields are `{ key, label, type: toggle|select|text|number, options? }`.
- **Action results**: row/table actions default to silent (the refreshed
  table is the feedback); set `result: "show"` when the route's return value is
  for the operator — objects render as labeled rows and a `copy` key becomes
  a copyable field (relative paths get the origin prepended).
- **Tier-2 page** (full React): `{ path, remote: "/ext/my-page.js" }` — an ESM
  file you serve yourself (e.g. a `boundary.http.app` mount). It reads
  `globalThis.__PATTERN_ADMIN__` for the shared `React`, `api` client, and the
  glass `ui` kit, and default-exports a component. Reach for Tier-2 only when a
  declarative view can't express the page.

## Recipe: add login & users (identity)

> If auth was chosen at scaffold time, this is already wired — skip to "What
> you get".

Add the identity mods to `pattern.config.json`:

```jsonc
{ "mods": ["@pattern/mod-identity", "@pattern/mod-auth-magic-link", "@pattern/mod-admin", "./mods/quotes.mjs"] }
```

(`npm i @pattern/mod-identity @pattern/mod-auth-magic-link` first.) What you get:

- **First boot** prints a one-time `/auth/bootstrap?t=…` link → first user
  becomes admin. Bootstrap is a **two-step** flow (the GET renders a form, the
  POST creates the admin — not a one-click GET). Magic-link / invite links are
  path-only on the **server console**; `identity.users.invite` also returns the
  link as `copy` in its result. Sign-in links print there until you subscribe a
  workflow to the `identity.deliverToken` hook (`payload: { email, url, purpose,
  delivered }` — send it, set `delivered: true`).
- **The admin's `requireAuth` starts being ENFORCED.** It always *declared*
  `admin` scope (the editor shows it even before you add identity, with a "not
  enforced — no provider" note); installing a provider just flips it on — a
  logged-out browser now redirects to `/auth/login`, and you **reconfigure
  nothing** (the admin's routes are code-derived each boot). Until a provider
  exists, `requireAuth` routes serve open and the host warns loudly on boot.
  Users / Invite / Sessions screens appear under "Access".
- **Protect any route** with `requireAuth` on its trigger (the editor's auth
  selector, or `{ "scopes": ["admin"] }` in config). Same rule everywhere: a
  declared requirement is enforced once a provider exists, advisory-open +
  warned before that. The trigger's **`user` output port** carries
  `{ id, email?, scopes, claims } | null` — wire it to scope data per user
  (e.g. `in.user → yourOp.owner`). In op code, `ctx.principal` has the same.
- Signup is **invite-only** by default; customize via a wrapper mod
  (`mods/identity.mjs` default-exporting `identityMod({ signup: "open", … })`)
  and list it instead of the bare package name.
- ⚠ Identity data lives in `./.pattern-data/` (gitignored). Never store
  user/PII data in `./.pattern/` — that directory is committed.

## Project layout

```
pattern.config.json   # mods to load + workflows dir — the app manifest
mods/quotes.mjs       # app-local mod: ops + admin page (the live example)
workflows/            # file-based workflow JSON (read-only in the admin)
src/index.ts          # loadProject() → start(); prints the admin URL
src/examples.ts       # first-boot seed (only into an empty ./.pattern store)
.pattern/             # admin workflow store: versions + audit — committed
```

## Verification loop

1. `npx pattern validate workflows/<file>.json` after every JSON edit.
2. `npm run dev`, then `curl localhost:3000/<route>` for routes.
3. Admin sanity: `/admin` → Workflows (is it live?), Runs (did it trace?),
   Ops (is your op registered, with description?).
4. One-off run without HTTP: `engine.run("<id>", { input: {...} })` from
   `src/index.ts` or a scratch script.
