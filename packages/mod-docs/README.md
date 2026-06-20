# @pattern-js/mod-docs

Self-reflecting documentation for Pattern apps. A markdown-first docs app at
`/docs` — the admin's visual language, tuned for reading — where **every
installed mod contributes its own chapter**, first or third party: install a
mod, its docs appear; the markdown ships inside the npm package, so what you
read always matches the version you run.

```jsonc
// pattern.config.json
{ "mods": ["@pattern-js/mod-docs"] }
```

## What you get

- **The Pattern handbook** — concepts + guides (create an app, projects &
  mods, authoring ops, identity, agents & chat, the admin), shipped with this
  package.
- **A generated op reference** (`/docs/ops`) — rendered from the LIVE registry
  of your installation: ports, config schemas, contributing mod, used-by.
  Hand-written "when to use" prose merges in via the `ops/<op.type>.md`
  convention. The signatures can't go stale; they're never written down.
- **Installed mods** (`/docs/mods`) — what each mod actually contributed.
- **Live workflow embeds** — a ` ```workflow ` fence containing workflow JSON
  renders as a real read-only graph (lazy-loaded; reading stays light).
- **⌘K search** across every chapter + the op reference.
- **`/docs/llms.txt`** — the whole doc set as one markdown body for agent
  readers, plus a raw `.md` view per page.

## Extending (any mod, including yours)

```ts
export default defineMod({
  name: "my-mod",
  docs: { filesystem: "my-mod-docs", title: "My Mod", order: 50 },
  setup(engine) {
    const dir = fileURLToPath(new URL("../../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "my-mod-docs", localFs(dir));
  },
});
```

Nav derives from frontmatter (`title:` / `order:`); `ops/<op.type>.md` files
become the op reference's prose. Full recipe: the handbook's "Extending these
docs" page.

## Options

| option | default | meaning |
|--------|---------|---------|
| `mount` | `"/docs"` | URL prefix (UI + API) |
| `requireAuth` | `{ env: "DOCS_REQUIRE_AUTH" }` | unset/false = public docs; `true`/scope list gates everything but `/docs/api/me` |
| `adminMount` | `"/admin"` | for "open in admin" links (shown only to readers whose admin probe succeeds) |
| `loginRequestPath` | `"/auth/magic-link/request"` | the sign-in card's endpoint when gated |
| `assets` / `content` | bundled | override the SPA assets / handbook content dirs |
| `cache` | `true` | memoize nav/search/llms per process; set `false` while writing docs |
