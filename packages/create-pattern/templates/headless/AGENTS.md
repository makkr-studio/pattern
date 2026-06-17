# Agent guide — {{name}} (Pattern · headless modpack)

You are working in a **Pattern** project: a workflow engine where logic lives in
**workflows** (JSON graphs of typed ops) and code lives in **ops** (plain
functions contributed by mods). This project is a **headless HTTP backend** —
routes are declared inside workflow JSON, no UI, no route table. Your job is
usually: add a route, or add an op. Recipes below.

## Ground rules

1. **Never guess op names or ports.** Ground truth is one command away:
   - `npx pattern ops` — every available op (core + this project's mods)
   - `npx pattern ops core.string` — filter by prefix
   - `npx pattern ops boundary.http.request` — full ports + config detail
2. **Validate every workflow JSON you touch:** `npx pattern validate <file>`,
   and `npx pattern graph <file>` to see the graph in the terminal.
3. `npm run dev` hot-reloads on file changes (workflows and mods included).
4. **Measure before optimizing:** `npx pattern load load.example.json` drives
   open-loop HTTP load and reports per-node engine time (where the latency
   actually goes); `--sweep` finds the max sustainable rps.

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
  "nodes": [
    {
      "id": "in",                        // unique within the workflow
      "op": "boundary.http.request",     // an op type — verify with `npx pattern ops`
      "comment": "Optional markdown note (shown by `pattern graph`).",
      "config": { "method": "GET", "path": "/things/:id" }
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

Routes are declared **inside the workflow**. The `boundary.http.request`
trigger's config carries method, `path` (`:segment` params), optional `port`,
`cors`, and JSON-Schema validation for `body` / `query` / `params` (enforced by
the engine; bad input → 400). Outputs:
`method, url, path, headers, query, params, body`. Pair it with
`boundary.http.response` (inputs: `body`, `status`, `headers`).

Drop the JSON in `workflows/` — registered at boot, hot-reloaded under
`npm run dev`. Objects written to `body` serialize as JSON automatically. The
existing files are canonical examples:

- `workflows/hello.json` — path params → template → JSON body
- `workflows/echo.json` — POST with JSON-Schema body validation
- `workflows/shout.json` — uses the app-local mod op `app.shout`
- `workflows/health.json` — separate port via `$env`, control-port edge

## Designing your API (read this before writing routes)

The shape to aim for — and the traps that look like progress:

1. **One workflow per action.** `POST /api/members`, `PATCH /api/members/:id`, …
   each its own route workflow = one traced run. Never a fat
   `POST /api/command` that switches on `{ entity, action }` — you lose
   per-action tracing and per-route validation.
2. **Ops never see HTTP.** The boundary owns validation (JSON-Schema → 400),
   auth (`requireAuth` → 401/403), and status (defaults 200). An op that takes
   `body`/`params`, returns `{ status, body }`, or checks scopes inside is
   coupled to HTTP and unusable from a CLI / schedule / another workflow. Keep
   it a pure domain function speaking domain ports.
3. **Decompose inputs, keep outputs whole** (the key asymmetry). Extract each
   field with a `core.object.get` (`object ← request.body`/`params`) so the
   request→op mapping is visible edges. But wire the op's single domain output
   (`member`, `client`, `state`) straight to `boundary.http.response.body` —
   reach for `core.object.build` only for a deliberate projection
   (rename/pick/merge) or a multi-op response, never to rebuild an entity the op
   already returns.
4. **Declare each input schema in ONE place.** A JSON-Schema on `request.body`
   *and* a Zod schema on the op's port makes the edge fail the validator
   (`… not assignable … (schema mismatch)`). Put it on the boundary (it returns
   the 400); keep op ports plain `value()` and guard invariants in your store
   layer.

## Recipe: serve a frontend

A built SPA is **just a workflow** — no server code. Register the assets as a
named filesystem in a mod's `setup`, then declare the app trio:

```js
// in a mod's setup(engine):
import { provideFilesystem, localFs } from "@pattern/runtime-node";
provideFilesystem(engine, "my-app", localFs("./app/dist"));
```

```jsonc
// workflows/app.json — boundary.http.app → core.app.static → boundary.http.app.serve
// edges: mount.out → assets.in,  assets.app → serve.app
{ "nodes": [
    { "id": "mount",  "op": "boundary.http.app",       "config": { "mount": "/" } },
    { "id": "assets", "op": "core.app.static",          "config": { "filesystem": "my-app", "spaFallback": "index.html" } },
    { "id": "serve",  "op": "boundary.http.app.serve" } ] }
```

`core.app.static.config.filesystem` is the **name** you registered, not a path.
The host resolves the app **once at registration**, so a rebuilt SPA needs a
restart — in dev, run the frontend's own dev server (Vite) for HMR and proxy
`/api` + `/auth` to the backend (`changeOrigin: false`, so magic-link callbacks
resolve to the dev origin). `app/dist` must exist at boot, so build it first.
(`@pattern/mod-admin` is the living example of this same trio — it just
registers imperatively because it ships as a package; an app author declares the
workflow file instead.)

## Recipe: add an op

Ops live in **mods**. This project has an app-local mod at
`mods/uppercase.mjs` — extend it or add a sibling file (then list it in
`pattern.config.json` → `mods`). Minimal contract (plain ESM, no build step):

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

## Recipe: protect routes (identity)

`npm i @pattern/mod-identity @pattern/mod-auth-magic-link`, list both in
`pattern.config.json` mods. Then on any route trigger:
`"config": { …, "requireAuth": true }` (or `{ "scopes": ["admin"] }`).
First boot prints a one-time bootstrap link; **bootstrap is a two-step
interactive flow** — the `GET /auth/bootstrap?t=…` renders a form, the `POST`
creates the first admin (not a one-click GET). Magic-link and invite links are
**path-only on the console** (`/auth/token?t=…`); `identity.users.invite`
returns the link in its result as `copy` (handy for scripted/seed flows), and
sign-ins print to the console until you subscribe a delivery workflow to the
`identity.deliverToken` hook. The trigger's `user` output port carries
`{ id, email?, scopes } | null` — wire it to scope data per user. To add app
scopes, wrap the mod: `identityMod({ roles: { editor: ["edit","read"] } })` is
the standard way. Identity data lands in gitignored `./.pattern-data/`.

## Project layout

```
pattern.config.json   # mods to load + workflows dir — the app manifest
mods/uppercase.mjs    # app-local mod: contributes `app.shout`
workflows/            # one JSON file per route
src/index.ts          # loadProject() → start()
```

## Verification loop

1. `npx pattern validate workflows/<file>.json` after every JSON edit.
2. `npm run dev`, then `curl localhost:3000/<route>`.
3. One-off run without HTTP: `engine.run("<id>", { trigger: "<nodeId>", input: {...} })`.

Want a visual editor, versioned deploys, and run traces on top of this exact
project? Add `@pattern/mod-admin` to `pattern.config.json` mods (and
`package.json`) — the admin appears at `/admin`.
