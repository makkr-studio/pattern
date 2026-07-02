---
title: Create an app
order: 10
---

# Create an app

> New here? [Getting started](../getting-started.md) walks the scaffold-run-open
> loop in 60 seconds. This guide is the next layer: what the scaffold gives you
> and how to grow it.

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
| `agent-chat` | store + vault + agents + AI + the **chat app** at `/chat` + admin. |

Then:

```bash
cd my-app
npm install
npm run dev        # pattern dev src/index.ts (watches and restarts)
```

## What the scaffold gives you

```
my-app/
  pattern.config.json     # which mods to load, where workflows live, ports
  workflows/              # workflows as JSON files (the app's behavior)
  mods/                   # app-local mods (optional)
  src/index.ts            # loadProject() → start()
  .env.example            # PATTERN_VAULT_KEY, provider keys (e.g. OPENAI_API_KEY), feature switches
  AGENTS.md               # recipes for coding agents working on the app
```

`src/index.ts` is deliberately tiny:

```ts
import { loadProject } from "@pattern-js/runtime-node";

const { start } = await loadProject();   // reads pattern.config.json
await start();                           // opens a server per declared port
```

Everything interesting is **data**: the mods list and the workflows directory.
A `.env` file next to `pattern.config.json` is loaded automatically on boot
(already-set environment variables always win).

## Growing the app

- **Add behavior**: drop a workflow `.json` into `workflows/`, or author
  visually in the admin and export.
- **Add capability**: install a mod and add it to `pattern.config.json`
  (see [Projects & mods](projects-and-mods.md)).
- **Add your own ops**: an app-local mod in `mods/` is a single `.mjs` file
  (see [Authoring ops](authoring-ops.md)).
- **Add a REST API**: give each action its own route workflow, and keep the
  ops pure (see [Designing your API](designing-your-api.md)).

## Serving your own frontend

Serving a built SPA is **a workflow**: the app is a node in the graph, no
server code. The app trio (`boundary.http.app` → `core.app.static` →
`boundary.http.app.serve`) mounts a registered filesystem; the dev loop proxies
API routes to the backend; and one backend can host many branded copies of the
same bundle. The full treatment, including the multi-instance / namespace
pattern, is its own guide: [Serve a frontend app](frontend-app-with-workflows.md).
