# Store

`@pattern/mod-store` is the persistence brick: **document collections** with
declared-index queries, a **blob store** for bytes (images, files), and
**leases** for cooperative concurrency. SQLite locally, behind drivers — a
different persistence layer is an adapter, not a rewrite.

```jsonc
{ "mods": ["@pattern/mod-store"] }
```

## Documents

Collections declare their indexed fields up front (`ensureCollection({ name,
indexes })` — idempotent, with backfill); queries filter on indexed fields
only, by design. Writes support CAS (`put(collection, id, data,
expectedVersion)`) so concurrent writers lose loudly instead of silently.

Reach it from ops via the `storeService` service, or on the canvas with
`store.get` / `store.put` / `store.patch` / `store.delete` / `store.query`.

## Blobs

`store.blob.put` (bytes or stream in, id out) + `store.blob.get`; a shipped
workflow serves `GET /store/blobs/:id` chunked. The chat app's image input
rides on this.

## Leases

`store.lease.acquire` is a CAS upsert: `{ ok: true, lease }` or `{ ok: false,
owner, expiresAt }` — a VALUE you branch on, never an exception. Leases
auto-release when their owning run settles (TTL as the crash backstop). The
chat app's one-turn-per-conversation rule is exactly one lease node.

## Admin

The **Data** section (Collections, Blobs) browses everything; `store.admin.*`
ops are admin-scope-guarded.
