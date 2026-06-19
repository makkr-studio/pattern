---
title: Hosting several branded instances
order: 20
---

# Hosting several branded instances

One `chatMod` registers **one shared backend** and fronts it with **many branded
SPA instances** — same bundle, different look, different data, different agent.
A `/sales` desk, a `/support` centre, an internal `/ops` bot… all over a single
set of endpoints.

```ts
chatMod({
  instances: [
    {
      mount: "/sales",
      namespace: "sales",
      brand: { accent: "#d2691e", title: "Pattern Sales" },
      agent: { name: "sales", instructions: "Upbeat sales assistant. Lead with value." },
    },
    {
      mount: "/support",
      namespace: "support",
      brand: { accent: "#2563eb", title: "Pattern Support" },
      // no agent → falls back to the generic turn pipeline
    },
  ],
})
```

## Namespace, decoupled from the path

The backend (conversations, turns, `/me`, blobs) is registered **once** at the
top-level `mount` (default `/chat`). Its data routes carry a `:ns` segment, e.g.
`/chat/api/:ns/conversations`. Each instance's SPA — served at its own `mount` —
sends its `namespace` in that segment, and the ops **partition the store** by it.
So `/sales` and `/support` share every endpoint yet keep **separate conversation
lists**, even on the same device. `/me` has no scoped data, so it stays bare.

`namespace` is optional: it defaults to the last segment of `mount` (so
`mount: "/sales"` → namespace `"sales"`), and `"default"` if the mount is bare.
Because it's decoupled from the path, two instances on different mounts can share
one namespace (same data, different brand) by naming the same `namespace`.

The brand (`accent`/`title`) + the namespace + the shared `apiBase` ride the
`chat.app` node's `manifest`, which the host injects as `window.__APP__` into the
served `index.html`. One static bundle, hosted anywhere, learns its identity at
load. (A single instance — no `instances` — keeps the canonical ids and the
`/chat` mount, unchanged.)

## A per-instance turn pipeline, by forking alone

The turn pipeline is the generic `/chat/api/:ns/conversations/:id/turns`
workflow. Give an instance its own `agent` and the mod mints a **namespace-pinned
fork** at `/chat/api/sales/conversations/:id/turns` — a *hardwired* path that
**out-ranks** the generic `:ns` route (the host matches most-specific-first). So
`/sales` turns run the sales agent while `/support`, un-forked, falls back to the
generic pipeline. No registry, no dispatch config — pipeline selection is just a
more-specific route. (This is general: forking any workflow with a concrete path
in place of a `:param` overrides the generic handler.)

To go beyond agent config — RAG, compaction, a different toolset — fork the whole
`chat.turn.pipeline` in the admin and give its trigger the hardwired `:ns` path.
See [Customizing the chat](./customizing.md).
