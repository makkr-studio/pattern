---
title: Serve a frontend app
order: 14
---

# Serve a frontend app with workflows

Serving a built single-page app is **just a workflow** — the app is a node in the
graph, not server code you write. The same mechanism serves the admin, the chat
app, and these docs. This guide covers the app trio, how assets are registered,
the dev loop, and the multi-instance / namespace pattern that lets one backend
host many branded copies of the same app.

## The app trio

Three nodes turn a folder of built assets into a live site:

```workflow
{
  "id": "app",
  "name": "my SPA",
  "nodes": [
    { "id": "mount",  "op": "boundary.http.app", "config": { "mount": "/" } },
    { "id": "assets", "op": "core.app.static", "config": { "filesystem": "my-app", "spaFallback": "index.html" } },
    { "id": "serve",  "op": "boundary.http.app.serve" }
  ],
  "edges": [
    { "from": { "node": "mount",  "port": "out" }, "to": { "node": "assets", "port": "in"  } },
    { "from": { "node": "assets", "port": "app" }, "to": { "node": "serve",  "port": "app" } }
  ]
}
```

- **`boundary.http.app`** — the trigger. Declares **where**: `mount`, `port`,
  `cors`, `requireAuth`. (App routes and API routes share a port; the most
  specific route wins — see below.)
- **`core.app.static`** — declares **what**: which assets, and the SPA fallback
  (serve `index.html` for client-routed paths). Its `filesystem` is a **name**,
  not a path.
- **`boundary.http.app.serve`** — the out-gate. Hands the resolved app to the host
  to mount.

Drop that into `workflows/` and your app is live at `/`. The trigger says where,
`core.app.static` says what, the out-gate hands it off.

## Registering the filesystem

`core.app.static.config.filesystem` is a **name** linking the mount to assets you
register in a mod's `setup` — not a filesystem path:

```ts
import { provideFilesystem, localFs } from "@pattern/runtime-node";

export default {
  name: "my-app",
  setup(engine) {
    provideFilesystem(engine, "my-app", localFs("./app/dist"));   // name ⇄ workflow's filesystem
  },
};
```

The **mount** is declared in the workflow; the **filesystem** is registered in
code; `filesystem: "my-app"` ties them together. (App *authors* declare the trio
as a workflow file; *mods* that ship endpoints — like `@pattern/mod-admin` —
register theirs imperatively in `setup`. Same trio, two registration styles; as an
app author, prefer the file.)

## Developing the frontend

> The host **resolves the app once at registration** and serves it statically.
> Great for prod, but a rebuilt SPA (new hashed filenames) is **not picked up
> without restarting the engine**.

- **Prod** — build the SPA first, then serve it via the trio. Because the app
  loads at boot, `app/dist` must already exist — have your `dev`/`start` script
  build the frontend before the engine starts, or `core.app.static` has nothing to
  resolve.
- **Dev** — run the frontend's own dev server (Vite, etc.) for HMR and **proxy**
  API + auth routes to the Pattern backend so everything is same-origin:

  ```ts
  // vite.config.ts — changeOrigin:false keeps the backend seeing the dev Host,
  // so auth callback URLs point back at the dev server.
  server: { proxy: {
    "/api":  { target: "http://localhost:3000", changeOrigin: false },
    "/auth": { target: "http://localhost:3000", changeOrigin: false },
  } }
  ```

## Talking to workflows from the SPA

The frontend is static; everything dynamic is a workflow behind an HTTP (or
WebSocket) boundary on the same origin:

- **Request/response** — a `fetch` to a `boundary.http.request` route (see
  [Designing your API](designing-your-api.md)).
- **Streaming** — a `boundary.http.response` in `sse` mode streams tokens/events
  to an `EventSource` (this is how chat streams a turn).
- **Realtime** — `boundary.ws.message` for bidirectional connections.

Keep the SPA dumb about internals: it calls routes, the workflows do the work.

## One backend, many branded instances

A powerful pattern: serve the **same** SPA bundle many times with different
parameters — different brand, different data namespace — all on one backend, no
per-copy endpoint duplication. `@pattern/mod-chat` ships exactly this (sales and
support desks over one chat backend). Two ingredients make it work:

**1. A mount-portable bundle + bootstrap injection.** Build the SPA with relative
asset paths (Vite `base: "./"`). At serve time the host injects a `<base>` tag and
a `window.__APP__` config object into the entry HTML, so the *same* bytes work
under any mount and learn their parameters at load:

```ts
// the SPA reads its instance config from the injected global
const { apiBase, namespace, accent, title } = window.__APP__;
```

**2. A namespace decoupled from the mount.** The data namespace is **not** the URL
path — it's a logical label sent on API calls and used to partition the store.
Routes carry it as a `:ns` segment (`/chat/api/:ns/conversations`), so one set of
endpoints serves every instance; the store filters by namespace. Same device,
different namespace → different data.

```ts
chatMod({
  instances: [
    { mount: "/sales",   namespace: "sales",   brand: { accent: "#d2691e", title: "Sales" } },
    { mount: "/support", namespace: "support", brand: { accent: "#2563eb", title: "Support" } },
  ],
})
```

Each instance contributes only a tiny SPA-serving workflow; the backend is
registered once. See the [Chat chapter](/docs/chat) for the full worked example.

## Most-specific-wins routing (and why it matters)

App mounts and API routes coexist on a port, and routes are matched
**most-specific-first**: a static path segment out-ranks a `:param` segment,
left to right. This is a general framework rule with a neat consequence — you can
**override a generic handler by forking it with a concrete path**. A generic
pipeline at `/chat/api/:ns/.../turns` is overridden, for one namespace, simply by
a forked workflow whose trigger hardwires `/chat/api/sales/.../turns`. No
dispatch table, no delegate op — the router picks the more specific route. That's
how a per-instance pipeline is selected by forking alone.
