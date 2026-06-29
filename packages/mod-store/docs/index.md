# Store

`@pattern-js/mod-store` is the persistence brick: **document collections** with
declared-index queries, a **blob store** for bytes (images, files), and
**leases** for cooperative concurrency. SQLite locally, behind drivers, so a
different persistence layer drops in as an adapter.

```jsonc
{ "mods": ["@pattern-js/mod-store"] }
```

## When to use / when not

Reach for mod-store when a workflow needs state that **outlives a single run**:
records you'll read back and query (conversations, users, jobs), uploaded
bytes you'll serve later, or a "only one of these at a time" lock across
concurrent runs. It's the durable floor the app-level mods build on.

Queries run on declared indexes only: no joins, no ad-hoc `WHERE` on arbitrary
columns, no query language to learn (you query the declared indexes; see
[Data modeling](guides/data-modeling.md)). For rich relational queries,
analytics, or full-text search, point a real database at the problem and wrap it
in your own mod. If the data is per-run scratch, pass it along edges and skip
persistence.

## Configure it

The bare-string install gets sensible defaults (SQLite under
`./.pattern-data/`). For custom paths or an in-memory store (tests), export a
local wrapper mod calling the factory:

```ts
import { storeMod } from "@pattern-js/mod-store";

export default storeMod({
  storage: "./.pattern-data/store.db", // or "memory"
  blobDir: "./.pattern-data/blobs",
  maxBlobBytes: 25 * 1024 * 1024,       // 25 MiB
  blobRoute: true,                       // GET /store/blobs/:id (or { requireAuth } / false)
});
```

`storage: "memory"` keeps everything in-process: perfect for tests, gone on
restart. The `.pattern-data/` paths are gitignored; never write the store into
the committed `.pattern/` directory.

## Documents

Collections declare their indexed fields up front (`ensureCollection({ name,
indexes })`, idempotent, with backfill); queries filter on indexed fields
only, by design. Writes support CAS (`put(collection, id, data,
expectedVersion)`) so a concurrent writer that loses the race fails loudly.

Reach it from ops via the `storeService` service, or on the canvas with
`store.get` / `store.put` / `store.patch` / `store.delete` / `store.query`.

## Blobs

`store.blob.put` (a Media value, bytes, data-URL, or text in; a `MediaRef`
`{ blobId, mime }` out) + `store.blob.get`; a shipped workflow serves
`GET /store/blobs/:id` chunked. The chat app's image input rides on this. A
blob-serve route is four nodes:

```workflow
{ "id": "store.route.blob",
  "name": "Store · GET /store/blobs/:id",
  "nodes": [
    { "id": "in",   "op": "boundary.http.request",  "config": { "method": "GET", "path": "/store/blobs/:id" } },
    { "id": "pick", "op": "core.object.get",         "config": { "path": "id" } },
    { "id": "blob", "op": "store.blob.get" },
    { "id": "out",  "op": "boundary.http.response",  "config": { "mode": "chunked" } }
  ],
  "edges": [
    { "from": { "node": "in",   "port": "params" },  "to": { "node": "pick", "port": "object" } },
    { "from": { "node": "pick", "port": "out" },     "to": { "node": "blob", "port": "id" } },
    { "from": { "node": "blob", "port": "status" },  "to": { "node": "out", "port": "status" } },
    { "from": { "node": "blob", "port": "headers" }, "to": { "node": "out", "port": "headers" } },
    { "from": { "node": "blob", "port": "bytes" },   "to": { "node": "out", "port": "stream" } }
  ] }
```

## Leases

`store.lease.acquire` is a CAS upsert: `{ ok: true, lease }` or `{ ok: false,
owner, expiresAt }`, a VALUE you branch on. Leases auto-release when their
owning run settles (TTL as the crash backstop). The chat app's
one-turn-per-conversation rule is exactly one lease node. Renew a held lease for
long work (`store.lease.renew`) and drop it early with `store.lease.release`.

## Integration

mod-store is the persistence layer the higher mods sit on:

- **mod-chat** stores every conversation and turn here (collections
  `chat.conversations` indexed on `ownerId`/`deviceId`, `chat.turns` on
  `conversationId`/`status`/`runId`), serves pasted images as blobs, and uses a
  per-conversation lease to enforce one running turn at a time.
- **mod-agents** history persists through the same store, so an agent's prior
  turns survive restarts.
- Pair with **mod-identity** to put a real user id in the `ownerId` index;
  pair with **mod-vault** when a stored record needs a secret (read the secret
  with `vault.read`, never write plaintext secrets into a document).

## Admin

The **Data** section (Collections, Blobs) browses everything; `store.admin.*`
ops are admin-scope-guarded.
