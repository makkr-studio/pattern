# Agent guide — {{name}} (Pattern · blank modpack)

You are working in a **Pattern** project: a workflow engine where logic lives in
**workflows** (JSON graphs of typed ops) and code lives in **ops** (plain
functions contributed by mods). This is the **blank slate** — just the engine,
one workflow, run programmatically from `src/index.ts`.

## Ground rules

1. **Never guess op names or ports.** Ground truth is one command away:
   - `npx pattern ops` — every available op
   - `npx pattern ops core.string` — filter by prefix
   - `npx pattern ops core.string.template` — full ports + config detail
2. **Validate every workflow JSON you touch:** `npx pattern validate <file>`,
   and `npx pattern graph <file>` to see the graph in the terminal.
3. `npm run dev` re-runs on file changes.

## Mental model (60 seconds)

- An **op** is a reusable definition: type id, typed input/output **ports**, a
  config schema, an `execute`. A **node** is an op instance in a workflow with
  its own `config`. **Edges** connect output ports to input ports.
- Ports have a kind — `value`, `stream`, or `control` — and only same-kind
  ports connect: value→value is a **barrier** (consumer awaits), stream→stream
  is **concurrent** with backpressure, control→control is a dataless sequencing
  pulse. Adapters cross kinds: `core.stream.accumulate` (stream→value),
  `core.stream.emit` (value→stream).
- Every op implicitly has control ports `in`/`out`. Control-flow ops
  (`core.flow.branch`, `core.flow.switch`) pulse **named** control-outs
  selectively; the untaken side is skipped.
- **Boundaries** connect a graph to the world: a **trigger** (its outputs are
  the external input — here `boundary.manual`) paired with an **out-gate**
  (its resolved inputs are the result — here `boundary.return`).

## Workflow JSON anatomy

See `workflows/greeting.json` — it is the canonical commented example. Shape:

```jsonc
{
  "$schema": "pattern/workflow/v1",
  "id": "my-flow",
  "nodes": [
    { "id": "in", "op": "boundary.manual", "config": { "outputs": ["x"] } },
    { "id": "work", "op": "core.math.add" },
    { "id": "out", "op": "boundary.return" }
  ],
  "edges": [
    { "from": { "node": "in", "port": "x" }, "to": { "node": "work", "port": "a" } },
    { "from": { "node": "work", "port": "out" }, "to": { "node": "out", "port": "value" } }
  ]
}
```

Run it from code:

```ts
const { engine } = await loadProject();
const result = await engine.run("my-flow", { input: { x: 41 } });
// result.outputs → { out: { value: ... } }
```

Config values support **env interpolation**:
`{ "$env": "VAR", "type": "number", "default": 3001 }` or `"${VAR:-fallback}"`.

## Recipe: add an op

Create an app-local mod (plain ESM, no build step), e.g. `mods/my-mod.mjs`,
and list it in `pattern.config.json` → `"mods": ["./mods/my-mod.mjs"]`:

```js
/** @type {import("@pattern-js/core").PatternMod} */
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

`execute` receives `ctx`: `await ctx.input.value("name")` per value input,
`ctx.config`, `ctx.signal` (AbortSignal). Return `{ portName: value }`.
TypeScript mods can use typed helpers from `@pattern-js/core` (`pureOp`,
`defineOp`, `required`, `value`, `stream`, `z`).

**Verify:** `npx pattern ops app.` must list your op.

## Growing this project

- **HTTP routes**: add a workflow with a `boundary.http.request` trigger (the
  route — method/path/port/validation — lives in its config), call
  `await start()` from `loadProject()`, and the server opens. No route table.
  Building a REST API or serving a frontend? One workflow per action, keep ops
  HTTP-free — add `@pattern-js/mod-docs` for the *Designing your API* and *Create
  an app* guides at `/docs`.
- **Visual admin**: add `@pattern-js/mod-admin` to `pattern.config.json` mods and
  `package.json` — a full control plane (editor, versions, runs, traces)
  appears at `/admin`.

## Verification loop

1. `npx pattern validate workflows/<file>.json` after every JSON edit.
2. `npm run dev` — the run's output prints to the terminal.
