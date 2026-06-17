---
title: Create an app
order: 10
---

# Create an app

The fastest path is the scaffolder:

```bash
npm create pattern@latest            # interactive
# or pick a modpack directly:
npm create pattern my-app -- --modpack studio       # engine + visual admin
npm create pattern my-app -- --modpack agent-chat   # the full agent + chat stack
```

| Modpack | What you get |
|---------|--------------|
| `blank` | The engine + an example workflow. No UI. |
| `headless` | Engine + HTTP host, API-first. |
| `studio` | Engine + the **admin** (visual editor, runs, catalog) at `/admin`. |
| `agent-chat` | store + vault + agents + OpenAI provider + the **chat app** at `/chat` + admin. |

Then:

```bash
cd my-app
npm install
npm run dev        # pattern dev src/index.ts — watches and restarts
```

## What the scaffold gives you

```
my-app/
  pattern.config.json     # which mods to load, where workflows live, ports
  workflows/              # workflows as JSON files — the app's behavior
  mods/                   # app-local mods (optional)
  src/index.ts            # loadProject() → start()
  .env.example            # OPENAI_API_KEY, PATTERN_VAULT_KEY, feature switches
  AGENTS.md               # recipes for coding agents working on the app
```

`src/index.ts` is deliberately tiny:

```ts
import { loadProject } from "@pattern/runtime-node";

const { start } = await loadProject();   // reads pattern.config.json
await start();                           // opens a server per declared port
```

Everything interesting is **data**: the mods list and the workflows directory.
A `.env` file next to `pattern.config.json` is loaded automatically on boot
(already-set environment variables always win).

## Growing the app

- **Add behavior** — drop a workflow `.json` into `workflows/`, or author
  visually in the admin and export.
- **Add capability** — install a mod and add it to `pattern.config.json`
  (see [Projects & mods](projects-and-mods.md)).
- **Add your own ops** — an app-local mod in `mods/` is a single `.mjs` file
  (see [Authoring ops](authoring-ops.md)).
- **Add a REST API** — give each action its own route workflow, and keep the
  ops pure (see [Designing your API](designing-your-api.md)).

## Serving your own frontend

Serving a built SPA is **just a workflow** — the app is a node in the graph,
no server code. Drop this into `workflows/` and your app is live at `/`:

```workflow
{ "id": "app",
  "name": "my SPA",
  "nodes": [
    { "id": "mount",  "op": "boundary.http.app", "config": { "mount": "/" } },
    { "id": "assets", "op": "core.app.static", "config": { "filesystem": "my-app", "spaFallback": "index.html" } },
    { "id": "serve",  "op": "boundary.http.app.serve" }
  ],
  "edges": [
    { "from": { "node": "mount",  "port": "out" }, "to": { "node": "assets", "port": "in" } },
    { "from": { "node": "assets", "port": "app" }, "to": { "node": "serve",  "port": "app" } }
  ] }
```

The trigger says **where** (mount, port, CORS, `requireAuth`); `core.app.static`
says **what** (which assets, SPA fallback); the out-gate hands it to the host.

> **Declarative, not imperative.** You may notice mods like `@pattern/mod-admin`
> register their SPA *imperatively* in `setup` via `registerWorkflowAsync`.
> That's for mods shipping endpoints as a package — **app authors declare a
> workflow file instead.** Mod-admin is the living example of the same app trio;
> just don't copy its registration style.

### Registering the filesystem

`core.app.static.config.filesystem` is a **name**, not a path — the string key
linking the declared mount to assets you register imperatively in a mod's
`setup`:

```ts
import { provideFilesystem, localFs } from "@pattern/runtime-node";

export default {
  name: "my-app",
  setup(engine) {
    provideFilesystem(engine, "my-app", localFs("./app/dist"));
  },
};
```

The **mount** is declared in the workflow; the **filesystem** is registered in
code; `filesystem: "my-app"` is what ties them together.

### Developing the frontend

The host **resolves the app once at registration** and serves it statically —
great for prod, but it means a rebuilt SPA (new hashed filenames) is **not
picked up without restarting the engine**. So:

- **Prod** — build the SPA, serve it via the workflow above. Because the app
  loads at boot, `app/dist` must already exist — have your `dev`/`start` script
  build the frontend first, or the static node has nothing to resolve.
- **Dev** — run the frontend's own dev server (Vite, etc.) for HMR and **proxy**
  API + auth routes to the Pattern backend so everything is same-origin:

  ```ts
  // vite.config.ts — changeOrigin:false keeps the backend seeing the dev Host,
  // so magic-link callback URLs point back at the dev server.
  server: { proxy: {
    "/api":  { target: "http://localhost:3000", changeOrigin: false },
    "/auth": { target: "http://localhost:3000", changeOrigin: false },
  } }
  ```
