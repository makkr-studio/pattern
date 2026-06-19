# {{pkgName}}

A [Pattern](https://github.com/) mod — a publishable npm package that extends a
Pattern engine with ops, workflows, an admin page, and a docs chapter.

## Develop

```bash
npm install
npm run build      # tsc → dist/
npm test           # vitest smoke test
```

## Try it in a host

A mod runs inside a Pattern app. Spin up a throwaway one and link this package in
with a `file:` dependency (deterministic across npm/pnpm/yarn/bun):

```bash
npm run build
npx create-pattern host-test --modpack studio    # a host with /admin
cd host-test
# package.json → dependencies:  "{{pkgName}}": "file:../{{name}}"   (adjust the path)
# pattern.config.json → mods:   "{{pkgName}}"
npm install && npm run dev
```

Then verify:

- `npx pattern ops {{opPrefix}}` — your op is registered.
- `curl localhost:3000/api/{{name}}/items` — the route responds.
- `/admin` → **Extensions → {{Title}}** — your page (if you scaffolded one).
- `/docs` → **{{Title}}** — your chapter.

## Publish

```bash
npm publish --access public
```

`files` ships `dist` + `docs`, so the runtime and the docs chapter both travel
with the package. Consumers add `"{{pkgName}}"` to their `pattern.config.json`
`mods`.

## Layout

```
src/ops.ts        # the op (pure logic)
src/routes.ts     # routes fronting the op
src/frontend.ts   # the admin page (Tier-1 declarative or Tier-2 remote)
src/app.ts        # serves the Tier-2 page's bundle (Tier-2 only)
src/index.ts      # defineMod(...) — the package's default export
docs/             # the chapter shipped at /docs
AGENTS.md         # the contract sheet for coding agents (CLAUDE.md points here)
```
