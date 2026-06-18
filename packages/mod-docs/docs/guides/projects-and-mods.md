---
title: Projects & mods
order: 11
---

# Projects, declarative boundaries & mods

How a Pattern app is structured, how routes stay declarative, how workflows
change at runtime, and how mods extend everything.

## A project

```
my-app/
  pattern.config.json     # what to load
  mods/                   # app-local mods (optional)
    uppercase.mjs
  workflows/              # workflows as JSON data
    hello.json
    echo.json
  src/index.ts            # loadProject() → start()
```

```jsonc
// pattern.config.json
{
  "mods": ["./mods/uppercase.mjs", "@acme/mod-auth"],  // app-local + npm
  "workflows": "./workflows",
  "http": { "port": 3000 }
}
```

```ts
// src/index.ts
import { loadProject } from "@pattern/runtime-node";

const { engine, start } = await loadProject();   // reads pattern.config.json
const { ports } = await start();                 // opens a server per declared port
```

`loadProject` installs the mods first (so their ops exist), then registers every
workflow `.json`. You get the `engine` back to do anything else.

## Boundaries are declarative

Routing is **not** wired in code. Each `boundary.http.request` node carries its
own route in config — method, path, port, CORS, and JSON-Schema validation for
body/query:

```jsonc
{
  "id": "in",
  "op": "boundary.http.request",
  "config": {
    "method": "POST",
    "path": "/users/:id",
    "port": 3000,                       // optional; defaults to the host's port
    "cors": { "origin": ["https://app.example.com"], "credentials": true },
    "body":  { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] },
    "query": { "type": "object", "properties": { "limit": { "type": "integer" } } }
  }
}
```

The host derives its routes by scanning registered workflows for these nodes.
Invalid bodies/queries get a `400` with located issues before the graph runs;
valid (and coerced) values flow out of the trigger's `body`/`query` ports — and
because the port schemas are derived from the same JSON Schema, downstream value
edges are type-checked too.

**Ports.** A route binds to its op `config.port` if set, otherwise the host
default. The default resolves as `defaultPort` (e.g. `pattern.config.json`'s
`http.port`, or the `HttpHost` option) → the `PORT` env var → `3000`. Routes are
grouped by resolved port, so `start()` opens **one server per distinct port** —
a public API and an admin/metrics endpoint can live on different ports just by
declaring `port` on the latter.

The JSON-Schema subset → Zod compiler is `jsonSchemaToZod` (in core); it's
runtime-neutral, so it serves both request validation and graph typing.

## Environment interpolation in config

Workflows are data, but a deployment needs to inject values (ports, hosts,
secrets, flags). Config supports two forms, resolved when the workflow is
registered — **before** validation, so typed refs satisfy the op's schema. `core`
resolves against an injected env map (runtime-neutral); `loadProject` injects
`process.env`.

**Typed object form** — for scalars that need a real type:

```jsonc
{ "$env": "ADMIN_PORT", "type": "number", "default": 3001 }
```

- `type`: `string` (default) · `number` · `integer` · `boolean` · `json` — casts the env string.
- `default`: used when the var is unset/empty. **No default + unset → a loud error** at registration (catches misconfig early).

**String interpolation** — for building strings:

```jsonc
"redis://${REDIS_HOST}:${REDIS_PORT:-6379}"   // :-fallback; always a string
```

`${...}` is reserved in config strings; write `$${...}` for a literal `${...}`.
For a non-string value use the object form. Resolving manually (e.g. for a custom
loader): `resolveWorkflowEnv(workflow, env)` or, on the engine, pass
`new Engine({ env: process.env })`.

## Config ports (the resolve phase)

`$env` covers the common case, but a boundary's config can also be **fed by
ops** — for fully computed configuration. A boundary op exposes *config ports*
(`boundary.http.request` → `method`, `path`, `port`); wire an op into one and the
engine evaluates the feeding sub-graph **once at registration** (the "resolve
phase"), freezes the result into config, and drops the edge. The remaining graph
is the per-request runtime graph.

```jsonc
// the route's port comes from an env var, cast to a number, default 3000
{ "from": { "node": "p",  "port": "out" }, "to": { "node": "in", "port": "port" } }
// where "p" is:
{ "id": "p", "op": "core.env", "config": { "name": "SVC_PORT", "type": "number", "default": 3000 } }
```

Because it's just ops, config can be *computed* — e.g. an env var → a
`core.string.template` → the `path`. `core.env` reads the injected `ctx.env`
(same map as `$env`), with type casting + default.

Rules and mechanics:

- **Two clocks.** Config ports resolve at registration; the rest runs per request.
- **Purity.** The config sub-graph must be pure sources/transforms — **no
  triggers, nothing reachable from a trigger** (config can't depend on the
  request). Violations are a clear error.
- **Async registration.** Resolving runs ops, so use
  `await engine.registerWorkflowAsync(wf)` (what `loadProject` calls). Plain
  `engine.registerWorkflow(wf)` stays synchronous for static / `$env` config and
  throws a helpful error if a workflow uses config ports.
- **`$env` is the sugar**, config ports are the composable form — keep both.

## Workflows are modifiable at runtime

The workflow registry is observable and mutable. Add, replace, or remove a
workflow at any time — the HTTP host re-derives its routes live (opening/closing
servers per declared port):

```ts
engine.registerWorkflow(wf);     // add or upsert (re-validates, re-wires hooks/events)
engine.updateWorkflow(wf);       // alias for the upsert
engine.unregisterWorkflow(id);   // remove (tears down its hooks/events)
engine.onWorkflowsChanged((c) => …);  // observe set/delete
```

This is the seam for the dynamic future: workflows are JSON files today, but the
same calls accept workflows loaded from a DB or pushed by an admin API. Upsert
tears down the previous definition's hook registrations and event subscriptions
first, so reloading never leaves stale wiring behind.

## Execution model: default inline, flag the heavy ones

Runs execute **on the host event loop by default**. That's the right place for
the common case: an I/O-bound workflow (HTTP calls, DB reads, an LLM stream)
spends its time *awaiting*, and the loop is already free during an await — moving
it to a worker would only add a serialization round-trip for no gain. A run only
*holds* the loop when an op does **synchronous compute** (a tight numeric loop,
parsing a big blob, crypto); while that op runs, nothing else does — including
the admin.

So offload is **selective and author-controlled, at the workflow level**:

- Set a workflow's **`offload`** flag (editor → toolbar gear → *Workflow
  settings*, or `"offload": true` in the JSON) and the engine runs that whole
  workflow on a **worker pool** instead of the loop. Everything else stays
  inline. The flag is the unit because the seam is then crossed once per run (at
  the boundaries), not once per node — lower latency than per-op offload, and
  simpler to reason about.
- An op can declare **`cpuHeavy: true`** — purely a *signal* (like
  `sensitivity`). It routes nothing; it makes the editor **nudge**: the gear
  badges amber and the validator warns "*N cpu-heavy nodes — Offload
  recommended*" when such a node sits in a non-offloaded workflow.

Configure the pool in `pattern.config.json` with **`workers`**:

```jsonc
{
  "mods": ["@pattern/mod-sample", "@pattern/mod-admin"],
  "workers": 2,                                  // pool size; off-loop runs land here
  // or: "workers": { "size": 2, "mods": ["@pattern/mod-sample"] }
}
```

`workers` as a number is the pool size; the object form also picks which mods
each worker loads (default: the project's `mods`). Exclude host-only mods (e.g.
`@pattern/mod-admin`) from the worker set via the `{ mods }` form — workers run
domain ops, not the control plane. **With no `workers` configured, an `offload`
flag degrades to a graceful no-op** (the run stays inline).

Limits to know: an offloaded workflow runs on the worker's **own** service/store
instances (a separate connection — fine for file/DB-backed state, not for
in-memory shared state), it **cannot reach live WebSocket sockets** (the
validator warns if an offloaded workflow uses `boundary.ws.*`), and offloaded
runs **aren't pausable** from the editor. The admin's **Process** page shows the
hybrid (inline default + the worker pool's size/inflight) and benchmarks the
difference a pool makes on a CPU-bound workflow.

## Mods

A **mod** is any module exporting a `PatternMod` (default export). It contributes
ops, workflows, auth providers, and hooks (bringing a frontend app is a planned
field):

```ts
import { defineMod } from "@pattern/core";

export default defineMod({
  name: "uppercase-mod",
  ops: [/* … */],
  workflows: [/* … */],
  authProviders: [/* … */],
  hooks: [{ name: "post.beforeSave" }],
  setup(engine) { /* anything imperative */ },
  ready(engine) { /* runs after EVERY mod of the batch is installed */ },
});
```

`setup` sees only the mods loaded before it; `ready` sees the whole batch — use
it for work that depends on other mods' ops (the admin bootstraps its stored
workflows there, so they may use ops from mods listed after it).

Three sources, one mechanism (`engine.useAsync(mod)` under the hood):

| Source | How |
|--------|-----|
| **1st-party** (this monorepo) | published as `@pattern/mod-*`; list the package name |
| **3rd-party** (npm) | install the dependency; list the package name |
| **app-local** | a file in your app; list a relative path (`./mods/foo.mjs`) |

`loadProject` loads them from `pattern.config.json`; or load explicitly with
`loadMods(engine, ["@acme/mod-x", "./mods/local.mjs"], { baseDir })`. A 3rd-party
mod is just an npm package — install it and add its name to the config.
