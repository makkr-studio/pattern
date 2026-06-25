# Agent guide — {{pkgName}} (a Pattern mod)

You are working on a **Pattern mod**: a publishable npm package that extends a
Pattern engine. Everything it contributes is bundled behind one `defineMod(...)`
object (`src/index.ts`). Your job is usually: add/edit an op, a route, the admin
page, or the docs. The contracts are below.

## Ground rules

1. **Never guess op names or ports.** `npx pattern ops` lists every op (run it in
   a host that has this mod installed — see "Test locally"). `npx pattern ops
   {{opPrefix}}` filters to this mod's ops.
2. **Build + smoke-test as you go:** `npm run build` (tsc) and `npm test`
   (vitest). The test installs the mod into a bare engine.
3. **`type` ids and the package `name` are public contracts** — namespace ops
   `{{opPrefix}}.*` so they never collide with another mod.
4. **Standalone package.** `@pattern-js/core` / `@pattern-js/runtime-node` / `zod` are
   **peer** deps (the host provides them). Don't add them as regular deps and
   don't bundle your own copy.

## The mod contract (`src/index.ts`)

```ts
export default defineMod({
  name: "{{pkgName}}",
  ops: [/* OpDefinition[] */],
  workflows: [/* Workflow[] — routes, app mounts, … */],
  frontend: { menu, commands, pages },   // optional admin UI
  docs: { filesystem, title, order },    // optional docs chapter
  setup(engine) { /* register filesystems / services */ },
});
```

## The op contract (`src/ops.ts`)

An op is a PURE function over typed ports — it never sees HTTP/auth.

```ts
export const itemsList: OpDefinition = {
  type: "{{opPrefix}}.items.list",          // namespaced, stable
  description: "…",                          // shows in the catalog — write one
  inputs: { /* name: value(z.string()) */ },
  outputs: { items: value(z.array(/* … */)) },  // NAMED outputs, never bare `out`
  execute: async (ctx) => ({ items: /* … */ }), // await ctx.input.value("x"); respect ctx.signal
};
```

For streaming, control flow, or sub-workflow calls, see the *Authoring ops* guide
at `/docs`.

## The route contract (`src/routes.ts`)

Routes are workflows that front a pure op. Use `httpEndpoint(...)` — never a
generic "run any op" endpoint; name the route.

```ts
httpEndpoint({
  id: "{{opPrefix}}.route.items",
  method: "GET",
  path: "/api/{{name}}/items",
  op: "{{opPrefix}}.items.list",
  io: { out: "items" },                       // op output → response body
  // input route: io: { in: { id: fromParams() }, out: "item" }  (also fromQuery/fromBody)
});
```

## The admin page (`src/frontend.ts`)

A `frontend` contribution adds UI to `@pattern-js/mod-admin` with **no admin
changes**. Two tiers, each bound to a dedicated route:

- **Tier 1** — a declarative `view` (table/form/chart/json/markdown/detail). No
  build step; the admin's kit renders it.
- **Tier 2** — a fully-custom React page shipped as `module` **source** (the ESM
  string in `frontend.ts`; its default export is the component). It reads its
  dependencies off the admin's shared global `__PATTERN_ADMIN__` — `React`, `api`
  (the client), `ui` (the glass kit), `motion` (motion.dev) and `lucide` — so it
  uses the admin's *exact* stack with no bundler. The admin serves that source
  from its own same-origin route and `import()`s it: **no workflow, no asset
  mount, no CSP relaxation** (a plain `script-src 'self'` covers it). **Never
  bundle your own React** — the admin renders your default export with its
  instance, and two Reacts break hooks. (Need JSX or libraries? Build a
  single-file ESM bundle with React externalized to the global and assign the
  built string to the page's `module`.)

## The docs chapter (`docs/`)

Markdown in `docs/` joins the handbook at `/docs` when the mod is installed
(`docs` field + the `provideFilesystem` registration in `setup`). Files under
`docs/ops/<op.type>.md` become the "when to use" prose in the op reference. Keep
`files` in `package.json` including `"docs"`.

## Test locally

```bash
npm run build
npx create-pattern host-test --modpack studio   # a host with /admin
# host-test/package.json deps:  "{{pkgName}}": "file:../{{name}}"
# host-test/pattern.config.json mods:  "{{pkgName}}"
cd host-test && npm install && npm run dev
```

Verify: `npx pattern ops {{opPrefix}}`, `curl localhost:3000/api/{{name}}/items`,
`/admin` (your page), `/docs` (your chapter).
