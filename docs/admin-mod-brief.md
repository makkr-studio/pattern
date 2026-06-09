# Pattern engine — brief for the admin-mod spec

A precise summary of the engine as built, oriented toward designing the **admin
mod** (an authorable-workflow editor that saves/deploys workflows at runtime).
It states what exists, the extension points the admin will use, and the known
gaps/open questions to design around. Authoritative design: `pattern-engine-spec.md`.

Status: engine + Node adapter + scaffolder implemented; **77 tests, all green**.
Packages currently at v0.1.1 (published to a local Verdaccio for testing).

---

## 1. What Pattern is

A **workflow execution engine**. A workflow is a **JSON document** describing a
directed graph of typed **ops** connected by **edges**. Ops carry the code (a
registry keyed by a type id); the engine never `eval`s anything in the JSON. A
run executes the graph to completion per invocation.

Defining properties: workflows are *data* (portable, inspectable, diffable,
versionable — the basis of the mod system); the **workflow is the unit of
isolation** (a whole run can execute off the host loop via a worker pool); the
**core is runtime-neutral** (Web standards only), with all platform code in the
Node adapter.

## 2. Packages

| Package | Role |
|---|---|
| `@pattern/core` | The runtime-neutral engine. One dependency: **Zod**. Types, validation, scheduler, op catalog, boundaries, hooks/events, auth, observability, env/config resolution, in-process transport. |
| `@pattern/runtime-node` | Node adapter: HTTP/WebSocket/CLI/schedule **hosts**, `node:worker_threads` pool transport, socket-bound connection registry, JSONL/SQLite trace sinks, the project loader, the mod loader, and the `pattern` CLI. |
| `create-pattern` | Scaffolder. Templates: `hello-workflow`, `http-api`. |

Monorepo: pnpm workspaces + changesets. Build with `tsc`. Tests with vitest.

## 3. Execution model (concepts)

- **Ports** are `value`, `stream`, or `control`. **Edge kind is derived from the
  ports it connects** (never declared):
  - *value→value* — a **barrier** (consumer awaits the produced value; resolves once).
  - *stream→stream* — **concurrent** dataflow with backpressure until close.
  - *control→control* — a **dataless barrier**: a sequencing pulse.
- Every op has an implicit control-in `in` and control-out `out`. Ordinary ops
  auto-pulse `out` on completion; control-flow ops (`branch`/`switch`/`gate`/…)
  declare **named** control-outs and pulse them selectively. A declared data port
  named `in`/`out` shadows the implicit control port (stream ops use `in`/`out`).
- value↔stream crossing is explicit: `core.stream.accumulate` (stream→value, a
  barrier) and `core.stream.emit` (value→stream). `z.any()` ports bypass strict
  schema checks.
- **Scheduler** (no topological sort): value ordering from promise deferreds,
  control from dataless pulses, stream fan-out from a backpressured hub. A branch
  not taken propagates a **skip** through the unreached subgraph so it settles
  instead of hanging. A value input with several producers (branch convergence)
  resolves to whichever actually fires.
- **One run = one trigger**; the engine executes the subgraph reachable from that
  trigger (plus the ancestors that feed it). A run is **result-ready** once its
  reachable out-gates capture results — a streaming out-gate (SSE) emits a live
  stream the host consumes *after* `run()` resolves.

## 4. The workflow document format (what the admin authors)

```jsonc
{
  "$schema": "pattern/workflow/v1",   // optional
  "id": "string",                      // required, unique
  "name": "string",                    // optional
  "version": "string",                 // optional
  "nodes": [
    {
      "id": "string",                  // required, unique within the workflow
      "op": "core.string.template",    // required, a registered op type id
      "title": "string",               // optional — short label
      "comment": "string",             // optional — free-form note (multi-line ok)
      "config": { }                    // optional — validated against the op's config schema
    }
  ],
  "edges": [
    { "from": { "node": "id", "port": "out" }, "to": { "node": "id", "port": "data" } }
  ]
}
```

- `title` + `comment` are **data-only annotations** (never affect execution),
  rendered by `pattern graph`. Built for self-documenting/educational workflows.
- An edge's kind is inferred from the resolved port kinds at both ends.

**Load-time validation** (human-readable, located at node/port) checks: ops
registered; configs parse; edges reference existing nodes/ports; edge kinds match
+ schemas compatible; no cycles; ≥1 trigger; each trigger reaches an out-gate
(except `boundary.event` / `boundary.schedule`). This is the function the admin
calls before saving.

## 5. Boundaries

Triggers have **no graph inputs** (their outputs are the external input, seeded by
the host; `execute` never runs). Out-gates have **no graph outputs** (their
resolved inputs are the external payload the host writes). Contracts live in core;
hosts that bind them live in `@pattern/runtime-node`.

| Trigger | Out-gate | Notes |
|---|---|---|
| `boundary.manual` | `boundary.return` / `boundary.return.named` | programmatic |
| `boundary.http.request` | `boundary.http.response` | declarative route (below); response `mode`: buffered/sse/chunked |
| `boundary.ws.message` / `.ws.open` / `.ws.close` | `boundary.ws.send` | per-message run; connection registry |
| `boundary.cli` | `boundary.cli.exit` | host-local |
| `boundary.schedule` | (result discarded) | interval or 5-field cron |
| `boundary.hook` | `boundary.hook.return` | filter-chain member |
| `boundary.event` | (none) | fire-and-forget subscriber |

**Declarative HTTP routing.** `boundary.http.request` config carries the whole
route: `method`, `path` (`:param` segments), `port`, `cors`, and **JSON-Schema**
`body`/`query` (validated → 400 on mismatch; the trigger's output port schemas are
derived from the same JSON Schema so the graph is typed). The host **derives its
routes by scanning registered workflows** — there is no programmatic route table.
It opens **one server per declared port**. Port resolution: op `config.port` →
host default → `PORT` env → `3000`.

## 6. Config: env + config ports

Two complementary mechanisms, both resolved **at registration, before validation**:

- **`$env` interpolation (sugar).** In config: a typed object form
  `{ "$env": "PORT", "type": "number", "default": 3001 }` (`type`:
  string/number/integer/boolean/json), and string form `"${VAR}"` /
  `"${VAR:-fallback}"` (`$${...}` escapes). Resolved against the engine's injected
  `env` map (the Node loader passes `process.env`). Missing + no default = a loud error.
- **`core.env` op + boundary config ports (the composable form).** A boundary op
  declares `configInputs` (`boundary.http.request` → `method`/`path`/`port`).
  Wire an op (e.g. `core.env`, consts, string/object ops) into one and the engine
  runs a **resolve phase**: it evaluates the backward-closure of those config
  ports once at registration, freezes the result into config, and drops the edge.
  So config can be *computed* (env → `core.string.template` → `path`). Soundness
  rule: the closure must be pure — **no triggers, nothing reachable from a
  trigger**. Workflows using config ports register via the **async** path (below).

## 7. Runtime modifiability (the deploy story — central to the admin)

The engine is built to load/reload workflows at runtime. **The admin deploy flow
already works** for HTTP and schedule:

```
author → engine.validate(wf)            // human-readable issues for the editor
       → persist to your store
       → await engine.registerWorkflowAsync(wf)   // goes live: routes, schedules, hooks, events
remove → engine.unregisterWorkflow(id)
```

- **Upsert semantics.** Registering an existing id **tears down the prior
  version's wiring** (hook registrations, event subscriptions) first, re-validates,
  re-runs the resolve phase, stores, and **notifies subscribers**.
- **Hosts react live.** The **HTTP host** re-derives routes (adds/removes routes,
  opens/closes per-port servers). The **schedule host** reconciles timers per
  workflow. Both subscribe to `engine.onWorkflowsChanged`.
- **In-flight safety (free).** A run holds the workflow object it started with;
  an update stores a *new* object — so updates/removes never disturb a run already
  executing. Effectively per-request atomic.
- **Sync vs async registration.** `engine.registerWorkflow(wf)` is synchronous and
  handles static + `$env` config; it **throws a clear error if the workflow uses
  config ports**, pointing to `engine.registerWorkflowAsync(wf)` (which runs the
  resolve phase). `loadProject` uses the async path.

## 8. Extensibility (how the admin plugs in)

- **Mods.** A `PatternMod` (default export) contributes `ops`, `workflows`,
  `authProviders`, `hooks`, and an imperative `setup(engine)`. Install with
  `engine.use(mod)`. `loadMods(engine, specifiers, { baseDir })` resolves **npm
  package specifiers** (1st- & 3rd-party) **and app-local relative paths**. Project
  config (`pattern.config.json`: `{ mods, workflows, http }`) is loaded by
  `loadProject()`. A "frontend app" field on `PatternMod` is **planned but not
  built** — relevant to the admin mod shipping a UI.
- **Hooks** — priority-ordered, payload-threading filter chain (fail-fast,
  short-circuit via `stop: true`, recursion guard, Zod-typed payloads). The lifecycle
  splice point.
- **Events** — fire-and-forget pub/sub.
- **Auth** — `Principal` (default `{ kind: "anonymous" }`), an `AuthProvider`
  registry/chain, per-trigger `requireAuth` (enforced by the host before the graph
  runs). User storage is a mod concern.

## 9. Op catalog & introspection (for the editor palette)

**159 base ops**: constants/sources (incl. `core.const.*`, `core.input`,
`core.env`), scalars (math/cmp/bool/cast), strings, objects, arrays (+ higher-order
`map`/`filter`/`reduce`/… via sub-workflow refs), control flow
(`branch`/`switch`/`gate`/`sequence`/`parallel`/`join`/`delay`/`try`/`throw`/`assert`/`noop`/`foreach`/`log`),
data/encoding (json/base64/url/query), time, crypto/hash/hmac/random, `http.fetch`,
streams (`split`/`merge`/`accumulate`/`emit`/`map`/`filter`), `ws.*`, hooks/events ops,
plus the boundary ops. Full list: `docs/op-catalog.md`.

**The op registry is the editor's source of truth.** `engine.ops.list()` returns
`OpDefinition`s; each exposes:

```ts
interface OpDefinition {
  type: string;            // unique id (the palette key)
  title?: string;
  description?: string;
  inputs:  Ports | (config) => Ports;   // port name → { kind, schema?, required?, description? }
  outputs: Ports | (config) => Ports;
  configInputs?: Ports | (config) => Ports;  // registration-time config ports
  controlOut?: string[] | (config) => string[];
  config?: ZodType;        // the node config schema
  boundary?: "trigger" | "outgate";
}
```

An editor can build its node palette, port pickers (with kinds + schemas), and
**config forms** from this. Config schemas are Zod; **Zod v4 has `z.toJSONSchema()`**,
so op config can be turned into JSON Schema for form generation. `formatGraph(wf, ops)`
gives a text rendering (used by `pattern graph`).

## 10. Observability, transport, CLI

- **Observability** — OTLP-shaped, zero-dependency spans (one trace/run, one
  span/node). `engine.onTrace(sink)` subscribes; runtime-node ships `jsonlTraceSink`
  and `sqliteTraceSink`. Emit, don't persist — useful for an admin "runs" view.
- **Transport / isolation** — `RunTransport` interface. In-process (default) and a
  `node:worker_threads` **pool** (streamed results + cancellation across the seam).
  *Caveat:* workers currently have only the base op catalog (no mods), and
  events/hooks fire in the worker's own engine (don't cross back).
- **CLI** — `pattern graph <file>` (renders nodes/ports/comments/edges),
  `pattern validate <file>` (located errors), `pattern dev [entry]` (watch + run).

## 11. Key APIs the admin mod will call

```ts
// Authoring / deploy
engine.validate(wf): Workflow                     // throws WorkflowValidationError (issues[])
collectIssues(wf, engine.ops): { ok, workflow, issues }   // non-throwing variant
await engine.registerWorkflowAsync(wf)            // deploy/upsert (runs resolve phase)
engine.registerWorkflow(wf)                       // sync; static/$env only
engine.updateWorkflow(wf) / engine.unregisterWorkflow(id)
engine.onWorkflowsChanged(({ type, id, workflow }) => …)  // type: "set" | "delete"

// Introspection (editor)
engine.ops.list() / engine.ops.get(type) / engine.ops.has(type)
engine.workflows.list() / .get(id) / .has(id) / .subscribe(listener)
formatGraph(wf, engine.ops): string

// Extensibility
engine.use(mod); engine.registerOp(op); engine.declareHook(def); engine.registerAuthProvider(p)
engine.emit(event, payload); await engine.invokeHook(name, payload)

// Run / inspect
await engine.run(wfOrId, { trigger?, input?, params?, principal? }): RunResult
engine.onTrace(sink)
```

`WorkflowRegistry` is an **interface** (`register/get/list/has/delete/subscribe`)
with an in-memory default — a DB-backed implementation drops in without touching
workflows. Same for the op/hook/auth/connection registries and the transport/bus.

## 12. Known gaps & open questions for the admin mod

1. **Persistence / source of truth.** The engine holds workflows in memory;
   `loadProject` hydrates from JSON files on boot. **No DB-backed registry or
   control-plane API is built** — that is the admin mod's job. Pattern: persist to
   a store, then `registerWorkflowAsync` on deploy; load-all on boot.
2. **WebSocket dynamic routing.** The WS host picks up *updates* to a bound
   workflow (re-resolves by id), but does **not auto-discover newly-deployed WS
   workflows** — inbound WS message routing isn't keyed like HTTP paths. Needs a
   routing decision (by connection path? a subscription key?).
3. **No route-conflict detection.** Two workflows claiming the same `method+path`
   → first-match wins silently. The admin will want this surfaced at deploy time.
4. **Mods can't ship a frontend yet.** `PatternMod` has no frontend-app field —
   relevant if the admin mod bundles its own UI.
5. **`engine.use(mod)` is synchronous**, so a mod shipping a *config-port* workflow
   would hit the sync-registration guard. May want an async mod-install path.
6. **Secrets.** `$env` / `core.env` resolve into the **stored config in plaintext**
   (visible in `pattern graph` / any config dump). No secret/redaction or
   lazy-at-runtime mechanism yet — worth designing if the admin edits secret-bearing
   config.
7. **No durable/resumable runs** (designed-for, not built). Run state is explicit
   and serializable to allow it later.
8. **Workflow-level `description`** — there's `name`; a longer description field is
   a trivial add if the editor wants it.

## 13. Design constraints to honor

Distribution is an invariant (not yet a feature, but nothing may preclude it):
workflow definitions, trigger inputs, run context (incl. `Principal`), and hook
payloads are **serializable**; dispatch goes through `RunTransport`; the bus, hook
registry, connection registry, and workflow registry all sit **behind interfaces**.
No shared mutable memory across runs; ops reach the outside only through `ctx`
capabilities (`ctx.params`, `ctx.env`, `ctx.services`, `ctx.invoke`). Keep the admin
mod's persistence and control-plane behind interfaces in the same spirit.
