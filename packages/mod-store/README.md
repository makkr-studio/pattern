# @pattern-js/mod-store

The persistence brick for [Pattern](../../README.md): **document collections**
with declared-index queries, a **blob store** for bytes (images, files), and
**leases** for cooperative concurrency. SQLite locally, behind drivers, so a
different persistence layer drops in as an adapter.

**Links:** [pattern-js.dev](https://pattern-js.dev) · [npm](https://www.npmjs.com/package/@pattern-js/mod-store)

```bash
npm install @pattern-js/mod-store
```

## When to use / when not

Reach for it when a workflow needs state that **outlives a single run**: records
you'll read back and query (conversations, users, jobs), uploaded bytes you'll
serve later, or a "only one of these at a time" lock across concurrent runs.

Queries run on declared indexes only: no joins, no ad-hoc `WHERE`, no query
language. For rich relational queries, analytics, or full-text search, wrap a
real database in your own mod. For per-run scratch, pass it along edges.

## Config

The bare-string install gets sensible defaults (SQLite under `./.pattern-data/`):

```jsonc
{ "mods": ["@pattern-js/mod-store"] }
```

For custom paths or an in-memory store (tests), export a local wrapper mod:

```ts
import { storeMod } from "@pattern-js/mod-store";

export default storeMod({
  storage: "./.pattern-data/store.db", // or "memory"
  blobDir: "./.pattern-data/blobs",
  maxBlobBytes: 25 * 1024 * 1024,      // 25 MiB
  blobRoute: true,                     // GET /store/blobs/:id (or { requireAuth } / false)
});
```

Reach it on the canvas with `store.get` / `store.put` / `store.patch` /
`store.delete` / `store.query`, the blob ops, and `store.lease.*`; or from ops via
the `storeService`. The `.pattern-data/` paths are gitignored.

Full documentation: the **Store** chapter at `/docs` (served by
`@pattern-js/mod-docs`), or [the source](docs/index.md).
