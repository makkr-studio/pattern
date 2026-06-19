---
title: Hosting several branded instances
order: 20
---

# Hosting several branded instances

One `chatMod` can serve the **same app many times** — each at its own mount,
with its own brand and its own agent. Same bundle, different doors, different
purposes (a `/sales` desk, a `/support` centre, an internal `/ops` bot…).

```ts
chatMod({
  instances: [
    {
      slug: "sales",
      mount: "/sales",
      brand: { accent: "#d2691e", title: "Pattern Sales" },
      agent: { name: "sales", instructions: "Upbeat sales assistant. Lead with value." },
    },
    {
      slug: "support",
      mount: "/support",
      brand: { accent: "#2563eb", title: "Pattern Support" },
      agent: { name: "support", instructions: "Calm, precise. Give step-by-step fixes." },
    },
  ],
})
```

Each entry is layered over the top-level options, so shared settings
(`requireAuth`, `maxTurns`, `guardrail`…) are set once and inherited.

## What's shared vs per-instance

Registered **once**: the ops, the chat store + collections, the SPA bundle, and
the admin **Chat** screens. **Per instance**: the SPA mount, all API routes, and
the turn/approval pipelines — their workflow ids are namespaced by `slug`
(`chat.spa` → `chat.sales.spa`), so they never collide and each shows up
separately in the admin. Each instance's `chat.{slug}.turn.pipeline` is a normal
workflow you can fork (see [Customizing the chat](./customizing.md)).

## How brand reaches the UI

`brand.accent` / `brand.title` are set on the instance's `chat.app` node and ride
the app descriptor's `manifest`. The host injects it as `window.__APP__` into the
served `index.html`, alongside a `<base href="${mount}/">` and the instance's
`apiBase`. The SPA reads `window.__APP__` on boot: it sets the UI's `--accent`,
the document/wordmark title, and derives its API root from `apiBase`.

That injection is also what makes ONE static bundle **mount-portable** — built
with relative asset URLs, it resolves under whatever mount it's served at. A
single instance (no `instances`) keeps the canonical `/chat` ids and behaves
exactly as before.
