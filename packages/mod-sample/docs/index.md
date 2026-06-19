---
title: Sample
order: 90
---

# Sample — anatomy of a mod

`@pattern/mod-sample` is the in-repo example third-party mod: read it to learn
the mod contract end to end. It extends the admin with a **Tier-1 declarative
page**, a **⌘K command**, and a **Tier-2 ESM remote** — and **zero admin-core
changes**. If the admin renders all of it without being touched, the extension
surface works. The whole thing is one file: `src/index.ts`.

```jsonc
{ "mods": ["@pattern/mod-sample"] }
```

## The mod shape — `defineMod`

A mod is a value you hand to `engine.use()`. `defineMod` takes a single object;
every field is optional except `name`:

```ts
export default defineMod({
  name: "@pattern/mod-sample",
  docs: { filesystem: "sample-docs", title: "Sample", order: 90 },
  ops: [greetingsList, crunch],          // OpDefinition[] — the nodes it adds
  workflows: [appMount, replayShowcase, greetingsRoute],  // Workflow[]
  frontend: { menu, commands, pages },   // declarative UI contribution
  setup: (engine) => { /* provide filesystems + services */ },
});
```

- **`ops`** are the new graph nodes the mod brings — pure `OpDefinition`s.
- **`workflows`** are pre-built graphs registered at boot (routes, demos).
- **`frontend`** is the admin UI contribution (data, not React; see below).
- **`docs`** points at a registered filesystem holding this chapter.
- **`setup(engine)`** runs at install: register filesystems and services here.

## Ops — pure nodes

An op is a typed function with named ports. `sample.greetings.list` is the
canonical pure read — no inputs, one named output, a Zod-validated shape:

```ts
const greetingsList: OpDefinition = {
  type: "sample.greetings.list",
  title: "sample.greetings.list",
  description: "Returns a static list of greetings (a declarative-page data source).",
  inputs: {},
  outputs: { greetings: value(z.array(z.object({ … }))) },
  execute: async () => ({ greetings }),
};
```

`sample.crunch` is the contrast: it takes input `n`, has a `config` schema (so
the editor renders a form), returns two outputs, and is tagged `cpuHeavy: true`
— which nudges the editor to suggest the workflow's Offload flag so the naive
fibonacci runs on the worker pool instead of the host loop.

## Routes — `httpEndpoint`

An op never gets exposed to the browser raw. The page and the ⌘K command reach
data through a **dedicated, named route** — a workflow that maps an HTTP request
onto the op and status-maps its output back. `httpEndpoint` builds that workflow
for you:

```ts
const greetingsRoute: Workflow = httpEndpoint({
  id: "sample.route.greetings",
  name: "Sample · GET /admin/api/sample/greetings",
  method: "GET",
  path: "/admin/api/sample/greetings",
  op: "sample.greetings.list",
  io: { out: "greetings" },
});
```

The op is the capability; the route is the service. There is no generic "invoke
any op" endpoint — every exposure is its own purposeful route, which is what
keeps the admin self-reflecting.

## Tier 1 — the declarative page

A `frontend` contribution is plain data. The page is a `menu` entry plus a
`pages` entry binding a path to a `view`. The `table` view names the route it
reads — wiring over a purposeful endpoint, not a new API:

```ts
frontend: {
  menu: [{ category: "Examples", label: "Greetings", icon: "boxes", path: "/x/greetings", order: 10 }],
  commands: [{ id: "sample.greet", label: "Sample: list greetings", group: "Examples",
               route: { method: "GET", path: "/sample/greetings" } }],
  pages: [
    { path: "/x/greetings",
      view: { kind: "table", route: { method: "GET", path: "/sample/greetings" },
              columns: [{ key: "id", label: "ID" }, … ] } },
    { path: "/x/studio", remote: "/ext/sample-studio.js" },  // Tier 2, below
  ],
}
```

The `commands` entry adds a ⌘K palette item that calls the same route. No build
step touches any of this — the admin's component kit renders it.

## Tier 2 — the ESM remote, served by the app trio

For a bespoke React page, the mod ships an ESM module whose default export is a
component and serves the bundle **itself**. It reads shared deps off the
`__PATTERN_ADMIN__` global so React, the API client, and the UI kit aren't
double-loaded:

```js
const { React, api, ui } = globalThis.__PATTERN_ADMIN__;
const { GlassPanel, PageHeader, Badge, NeonButton, JsonView } = ui;
export default function SampleStudio() { /* … calls api.call("GET", "/sample/greetings") … */ }
```

The `pages` entry points at it by URL (`remote: "/ext/sample-studio.js"`). The
bundle is mounted by the canonical **app trio** — a `boundary.http.app` mount
trigger, a `core.app.static` app op over a registered filesystem, and a
`boundary.http.app.serve` out-gate:

```ts
const appMount: Workflow = {
  id: "sample.app",
  nodes: [
    { id: "mount",  op: "boundary.http.app", config: { mount: "/ext" } },
    { id: "assets", op: "core.app.static",   config: { filesystem: "sample-assets", spaFallback: "" } },
    { id: "serve",  op: "boundary.http.app.serve" },
  ],
  edges: [
    { from: { node: "mount",  port: "out" }, to: { node: "assets", port: "in" } },
    { from: { node: "assets", port: "app" }, to: { node: "serve",  port: "app" } },
  ],
};
```

`setup` registers the filesystem the trio serves (here an in-memory FS holding
the one bundle) and the docs filesystem:

```ts
setup: (engine) => {
  const fs = memoryFs();
  void fs.write("sample-studio.js", STUDIO_REMOTE);
  provideFilesystem(engine, "sample-assets", fs);
  // packaged docs/ chapter, guarded so it's skipped when shipped without docs
  const dir = fileURLToPath(new URL("../docs", import.meta.url));
  if (existsSync(dir)) provideFilesystem(engine, "sample-docs", localFs(dir));
},
```

## The takeaway

Two ops, three workflows, one declarative `frontend` block, and a `setup` that
registers two filesystems — and the admin gains a menu, a page, a command, and a
whole custom React screen, untouched. That is the mod contract. For the deep
design behind the extension surface, see the [Admin internals](/docs/admin/internals).
