---
title: Data modeling
order: 10
---

# Data modeling with mod-store

mod-store is deliberately small: document collections, blobs, leases. The
shape of your data is *your* decision. Here's how to make it well.

## Three facilities: pick the right one

| Use a… | when the data is… | reach for |
| --- | --- | --- |
| **document** | structured state you read back and query (a record, a status, a counter) | `store.get` / `store.put` / `store.patch` / `store.query` |
| **blob** | opaque bytes (an image, an upload, a file) you'll stream out later | `store.blob.put` / `store.blob.get` |
| **lease** | a short-lived *exclusive claim* ("only one run does X at a time") | `store.lease.acquire` / `renew` / `release` |

The line between them: documents are JSON you index and filter; blobs are
bytes you never query (a document holds the blob *id* and the queryable
metadata); leases hold no data at all; they're a coordination primitive that
happens to be persisted. Don't stuff a base64 image into a document (it bloats
every read and can't stream); don't model a lock as a document with a
`locked: true` field (you'd race on it, which is exactly what a lease prevents).

## Declare your indexes up front

A collection names the fields it can be queried on:

```ts
await stores.docs.ensureCollection({ name: "orders", indexes: ["userId", "status"] });
```

`ensureCollection` is idempotent and **backfills**: add a field to `indexes`
later and existing docs get indexed on next ensure. Queries (`store.query`)
filter on indexed fields only, by design: no accidental full-table scans hide
in your workflow. Need a new filter? Add the index; don't reach for a scan.

**Why the constraint?** "Only indexed fields are queryable" is what lets every
driver (the in-memory store, SQLite, and any future adapter) honor the same
contract without a query planner. It also makes performance predictable: there
is no shape of query that quietly degrades into scanning the whole collection,
because the engine won't run a filter on a field you didn't declare.
The cost is one decision up front (which fields do I filter on?); the payoff is
that you never debug a mystery slow query.

## Write safely with CAS

`store.put` without a `version` upserts; WITH one it's compare-and-swap:
`ok:false` means someone wrote first, so re-read and retry to avoid
clobbering. Whenever two runs might touch the same document (a counter, a
status field, a conversation), thread `version` through:

```
store.get → (mutate) → store.put (version ← the read's version) → branch on ok
```

In op code the loop is small (the chat app's `casPut` helper, a good pattern
to copy):

```ts
async function casPut(svc, collection, id, mutate) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await svc.docs.get(collection, id);
    if (!row) return;
    const next = mutate({ ...row.data });
    if (await svc.docs.put(collection, id, next, row.version)) return; // ok → done
    // ok:false → someone wrote between our get and put; loop re-reads the fresh version
  }
}
```

`store.patch` bakes this in: it's CAS-only (`version` required), so a
shallow-merge update never resurrects a deleted doc or silently overwrites a
concurrent write.

### The anti-pattern

The failure mode is **last-write-wins on a blind put**: `store.put` *without* a
version, after a read, when another run might also be writing. The second
writer's change vanishes with no error. If two runs can touch a document, the
versioned path isn't optional.

The other anti-pattern is **querying un-indexed fields**, or worse, pulling a
whole collection back to filter it in the workflow. `store.query` won't filter
on a field you didn't declare, so reaching for an unbounded read (`limit` wide
open, no `where`) to scan in memory is fighting the design. Add the index
instead; `ensureCollection` backfills the existing docs.

## Leases: TTL + run-settle auto-release

A lease is a named, TTL'd, owned claim. `store.lease.acquire` is a CAS upsert
returning `{ ok:true, ... }` or `{ ok:false, owner, expiresAt }`: a value you
branch on (wire it into `core.flow.branch`).

Two things release a lease, so a workflow can't leak a lock:

1. **The owning run settles.** By convention the owner is the `runId`; the mod
   drops every lease owned by a run the moment that run ends (ok, error, or
   cancel). This is the normal path: most workflows never call `release`.
2. **The TTL expires.** The crash backstop: if the process dies before settle,
   the claim lapses on its own after `ttlMs` (default 60s).

For **long or streaming** work, two adjustments: heartbeat the lease with
`store.lease.renew` so the TTL doesn't lapse mid-work, and, if the run
"settles" before your work truly finishes, own the lease under an id *you*
control (separate from the runId), then `store.lease.release` at your terminal
event. A streaming response settles when its stream is *captured*, before it
drains; the chat pipeline therefore owns `chat:conversation:{id}` under
`turn:{turnId}`, renews while events flow, and releases when the turn ends, so
auto-release can't pull the lock out from under a turn that's still streaming.

## Blobs for bytes

Bytes (images, uploads) go in the **blob** store (`store.blob.put` → a
`MediaRef`; served by the shipped `GET /store/blobs/:id`, or `store.blob.get`
wired into your own response). Store the returned `blobId` (and any metadata
you'll filter on) in a document; keep the bytes out of the document body. Blobs
aren't garbage-collected. When you `store.delete` a record that owns a blob,
delete the blob too (`store.blob.delete`) or the bytes leak.

## Scoping by owner

There's no built-in multi-tenancy; model it as data. The chat app indexes
conversations by `ownerId` (a user) OR `deviceId` (an anonymous cookie) and
filters queries by whichever the request carries. Put the scope in an indexed
field and every query is a tenant query.

## Where this sits

mod-store is the persistence floor under the app mods. **mod-chat** is the
worked reference for everything above: declared-index collections
(`chat.conversations`, `chat.turns`), `casPut` for concurrent turn updates,
blobs for pasted images, and a per-conversation lease for its
one-turn-at-a-time rule. **mod-agents** history persists through the same
store. When a record needs a credential, keep the secret in **mod-vault** and
the document holds only the reference.
