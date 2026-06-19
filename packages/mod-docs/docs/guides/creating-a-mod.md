---
title: Create a third-party mod
order: 15
---

# Create a third-party mod

A **mod** is an npm package that extends a Pattern engine: it can contribute ops,
workflows (incl. HTTP routes), an admin page, auth providers, hooks, and a docs
chapter — all behind one `defineMod(...)` object. Install it, add it to
`pattern.config.json`, and its capabilities appear in the catalog. This guide
builds one end to end. The in-repo [`@pattern/mod-sample`](/docs/sample) is the
canonical reference; read it alongside.

## Scaffold it

```bash
npm create pattern@latest
# choose: "A mod"  → then pick the pieces (ops, workflows, admin page, docs)
```

The scaffolder asks what your mod includes and generates a publishable package:
`package.json` (with a `@scope/mod-<name>` name and the right peer deps),
`src/index.ts` exporting `defineMod(...)`, an example op and route, an optional
admin page, a `docs/` chapter, a test, and an `AGENTS.md` for coding agents. If
you opt into a Tier-2 admin page, it pre-wires the **admin's own stack** (React +
Tailwind + Motion + lucide) so the page drops in seamlessly — or choose
bring-your-own-stack and wire it yourself.

> Prefer to build by hand? Everything below is what the scaffold sets up.

## The mod object

```ts
import { defineMod } from "@pattern/core";
import { greet } from "./ops.js";
import { greetRoute } from "./routes.js";

export default defineMod({
  name: "@acme/mod-greetings",
  ops: [greet],
  workflows: [greetRoute],
  // frontend: { … }   // an admin page (optional)
  // docs: { filesystem: "greetings-docs", title: "Greetings", order: 50 },
  setup(engine) { /* register filesystems, services */ },
});
```

`name` and op `type` ids are stable public contracts — namespace your ops
(`acme.greet`, not `greet`) so they can't collide with another mod.

## Add an op

Ops are plain functions over Web standards (see [Authoring ops](authoring-ops.md)):

```ts
import { pureOp, required, z } from "@pattern/core";

export const greet = pureOp({
  type: "acme.greet",
  inputs: { name: required(z.string()) },
  output: z.string(),
  compute: ({ name }) => `Hello, ${name}!`,
});
```

Verify it registered: `pattern ops acme` lists your mod's ops with their ports.

## Add a route

Front an op with an HTTP route using `httpEndpoint` (a workflow builder) so the op
stays pure and HTTP-free:

```ts
import { httpEndpoint } from "@pattern/core";

export const greetRoute = httpEndpoint({
  id: "acme.route.greet",
  method: "GET",
  path: "/api/greetings/:name",
  op: "acme.greet",
  io: { /* map request → op input, op output → response body */ },
});
```

## Add an admin page (optional)

Contribute a page via the mod's `frontend` block — **Tier 1** (declarative, no
build) renders a table/form/chart over one of your ops; **Tier 2** ships a built
React bundle the admin loads at runtime. See
[Admin → extension surface](/docs/admin) and `@pattern/mod-sample` for both.

## Ship a docs chapter

Put markdown in a `docs/` folder, register it as a filesystem in `setup`, and
point the `docs` field at it — your chapter joins this handbook when your mod is
installed. Files under `docs/ops/<type>.md` become the "when to use" prose in the
op reference. Full recipe: [Extending these docs](extending-the-docs.md).

## Test it locally before publishing

Build, then install it into a throwaway app with a `file:` dependency (works
across npm/pnpm/yarn/bun):

```bash
npm run build                                   # → dist/ (+ app/dist if Tier-2)
npx create-pattern host-test --modpack studio   # a host with /admin to see your page
cd host-test
# add to package.json deps:  "@acme/mod-greetings": "file:../mod-greetings"
# add "@acme/mod-greetings" to pattern.config.json → mods
npm install && npm run dev
```

Then verify: `pattern ops acme` (op registered), `curl localhost:3000/api/greetings/world`
(route works), `/admin` (your page), `/docs` (your chapter). The shipped
`tests/` give a fast pre-publish signal without a host.

## Publish

```bash
npm publish --access public
```

Make sure `package.json` `files` includes `dist` and `docs` so the runtime and the
docs chapter ship. Consumers add `"@acme/mod-greetings"` to their
`pattern.config.json` `mods` list and it's live.
