---
title: Data modeling
order: 10
---

# Data modeling with mod-store

mod-store is deliberately small: document collections, blobs, leases. The
shape of your data is *your* decision — here's how to make it well.

## Declare your indexes up front

A collection names the fields it can be queried on:

```ts
await stores.docs.ensureCollection({ name: "orders", indexes: ["userId", "status"] });
```

`ensureCollection` is idempotent and **backfills** — add a field to `indexes`
later and existing docs get indexed on next ensure. Queries (`store.query`)
filter on indexed fields only, by design: no accidental full-table scans hide
in your workflow. Need a new filter? Add the index; don't reach for a scan.

## Write safely with CAS

`store.put` without a `version` upserts; WITH one it's compare-and-swap —
`ok:false` means someone wrote first, so re-read and retry. Whenever two runs
might touch the same document (a counter, a status field, a conversation),
thread `version` through:

```
store.get → (mutate) → store.put (version ← the read's version) → branch on ok
```

The chat app's `casPut` helper loops this up to 5 times — a good pattern to
copy.

## Blobs for bytes, leases for turns

Bytes (images, uploads) go in the **blob** store (`store.blob.put` → id;
served by the shipped `GET /store/blobs/:id`). For "only one of these at a
time" use a **lease** (`store.lease.acquire`) — a CAS upsert that returns
`{ ok:false, owner }` on contention instead of throwing, and auto-releases
when the owning run settles. The chat app's one-turn-per-conversation rule is
a single lease node.

## Scoping by owner

There's no built-in multi-tenancy — model it as data. The chat app indexes
conversations by `ownerId` (a user) OR `deviceId` (an anonymous cookie) and
filters queries by whichever the request carries. Put the scope in an indexed
field and every query is a tenant query.
