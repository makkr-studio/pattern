# @pattern-js/mod-admin

[Website](https://pattern-js.dev) · [npm](https://www.npmjs.com/package/@pattern-js/mod-admin)

An authorable, self-reflecting **control surface** for a Pattern engine: workflow
authoring, live deploy, run inspection, versioning, and a catalog of everything
in the system. It is an ordinary **mod**, a brick you `engine.use()`.

> **Status:** the control plane, workflow store, versioning, the `admin.*` ops,
> the self-reflecting HTTP API, and the in-memory run/metrics sink all ship. The
> React SPA (React 19 + `@xyflow/react` + Tailwind v4) is built into the package's
> `dist-app/` and served by the app boundary.

## Install

```ts
import { Engine } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";
import { adminMod } from "@pattern-js/mod-admin";

const engine = new Engine();
// useAsync so the mod's async setup (services + bootstrap) completes first.
await engine.useAsync(adminMod({ mount: "/admin", storage: "./.pattern" }));

const host = createHttpHost(engine);
await host.start(); // serves /admin (UI) + /admin/api/* (the workflow-backed API)
```

`adminMod(options)`:

| option | default | meaning |
|--------|---------|---------|
| `mount` | `"/admin"` | URL prefix for the UI + API |
| `storage` | `"./.pattern"` | workflow store (a dir path or a `Filesystem`) |
| `storePrefix` | `"workflows"` | path prefix inside the store |
| `assets` | built SPA (`dist-app/`) | SPA assets (a dir path or a `Filesystem`) |
| `auth` | `{ scopes: ["admin"] }` | stamp `requireAuth` (+ scopes) on every endpoint; inert until an `AuthProvider` mod is installed. Pass `auth: false` for an acknowledged-public admin. |
| `traceCapacity` | `500` | runs retained in the in-memory sink |

## How it self-reflects

The admin's **backend is authored in the same primitives it edits**. Every API
route is a workflow `http.request → admin.<op> → http.response`; the HTTP host
derives its routes by scanning them, so the admin's own control plane appears in
its catalog and is editable inside itself. The only HTTP surface is workflows;
persistence/versioning/enable-state live behind an internal `ControlPlane`
service (`ctx.services.adminControlPlane`) with a `Filesystem` inside.

```
GET  /admin/api/workflows            admin.workflow.list
GET  /admin/api/workflows/:slug      admin.workflow.get
POST /admin/api/workflows/:slug      admin.workflow.save        (validate + snapshot)
POST /admin/api/deploy/:slug         admin.workflow.deploy      (route-conflict checked)
GET  /admin/api/ops[/:type]          admin.op.list / .get
POST /admin/api/ports/compatible     admin.ports.compatible
GET  /admin/api/runs[/:id|/tail]     admin.run.list / .get / .tail (SSE)
GET  /admin/api/metrics              admin.metrics.summary
GET  /admin/api/versions…/diff       admin.version.list / .get / .diff
GET  /admin/api/mods | /templates    admin.mod.list / admin.template.list
GET  /admin/*                        boundary.http.app (SPA, served by the host)
```

## Lifecycle & provenance

- **Provenance** `code | file | db`. Code workflows (registered by a mod at boot)
  are read-only/forkable; file workflows are authorable; db is reserved.
- **Versioning**: one live version per slug; immutable, content-addressed
  snapshots; promote/rollback is a one-click pointer move; structural JSON diff
  between any two versions.
- **Enable/disable** is control-plane state: enabled + live → registered under
  the slug's stable id; otherwise stored-but-unregistered. Route conflicts on
  activation return `{ ok: false, conflicts }` (the UI offers cancel/swap).

See the [admin internals](docs/internals.md) for the full design and the engine
seams it builds on (served at `/docs/admin` once the docs mod is installed).
