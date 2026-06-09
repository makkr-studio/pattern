# Admin engine prerequisites (mod-admin-spec §2)

The admin mod (`@pattern/mod-admin`) is built *on* the engine, not *into* it. Per
the spec, a handful of small, generally-useful capabilities had to land in
`@pattern/core` / `@pattern/runtime-node` first. This is the status of each.

| # | Need | Status | Where |
|---|------|--------|-------|
| **P1** | App-serving boundary | ✅ done | `boundary.http.app` op ([`boundaries/index.ts`](../packages/core/src/boundaries/index.ts)); static serving + SPA fallback in the HTTP host ([`http.ts`](../packages/runtime-node/src/http.ts)); `Filesystem` abstraction ([`filesystem.ts`](../packages/runtime-node/src/filesystem.ts)). |
| **P2** | `frontend` on `PatternMod` | ✅ done | `FrontendContribution` ([`frontend.ts`](../packages/core/src/frontend.ts)); `engine.frontend()` aggregation + `engine.installedMods()`. |
| **P3** | Async mod install | ✅ done | `engine.useAsync(mod)` runs the resolve phase; `use()` stays sync and throws its guidance error. |
| **P4** | Secret-safe config | ✅ done | `secret()` Zod tag + `redactConfig()` ([`redact.ts`](../packages/core/src/redact.ts)); env-derived paths tracked at registration; `engine.redactedConfig(wf, node)`; wired into `formatGraph`. |
| **P5** | In-process routing | ✅ ready | No engine change: the default transport **is** in-process (`InProcessTransport`). The admin holds a plain `Engine` (no worker pool) so mod ops / `ctx.services` / hooks resolve in-process. |
| **P6** | Admin auth seam | ✅ ready | No engine change: triggers already accept `requireAuth` (+ scopes) and the HTTP host enforces it before the graph runs. The admin stamps one config across its endpoint workflows at registration. |
| **T1** | Trace I/O sampling | ✅ done | `SpanData.io` + `IoSample` ([`types.ts`](../packages/core/src/types.ts)); opt-in via `run({ sampleIo: true })`; bounded + maskable sampler ([`observability/sample.ts`](../packages/core/src/observability/sample.ts)). Off by default. |
| **T2** | Port-compat primitive | ✅ done | `portCompatibility(from, to) → { ok, reason?, fix? }` ([`schema-compat.ts`](../packages/core/src/schema-compat.ts)) — the single source of truth for validation and the editor's `admin.ports.compatible`. |
| **T3** | Document fields | ✅ done | `description`/`tags`/`source` on the workflow, `ui` per node ([`types.ts`](../packages/core/src/types.ts)). Data-only; never affect execution. |
| **T4** | Sink aggregates | admin-side | The admin's in-memory ring-buffer sink (with windowed counters + latency histogram) lives in `mod-admin`; it subscribes via `engine.onTrace`. No engine change beyond T1. |

## New seams worth knowing

### Extensible services (`ctx.services.<name>`)

`OpServices` now carries the three core capabilities **plus** anything a mod
registers with `engine.provideService(name, impl)`. The services object is a
stable reference the transport captures once, so services registered later
(e.g. from a mod's `setup`) are visible to subsequent runs. The admin reaches
its control plane as `ctx.services.adminControlPlane`; the HTTP host resolves
named filesystems from a `FilesystemRegistry` service.

```ts
engine.provideService("adminControlPlane", controlPlane);
// inside an op:
const cp = ctx.services.adminControlPlane as ControlPlane;
```

`engine.service<T>(name)` reads one back (typed-loose; narrow at the call site).

### App boundary + filesystems

```jsonc
// a workflow that serves an SPA — one node, no graph
{ "id": "admin-ui", "nodes": [
  { "id": "app", "op": "boundary.http.app",
    "config": { "mount": "/admin", "filesystem": "admin-assets",
                "spaFallback": "index.html", "immutableAssets": true } }
], "edges": [] }
```

```ts
import { provideFilesystem, LocalFilesystem } from "@pattern/runtime-node";
provideFilesystem(engine, "admin-assets", new LocalFilesystem("./dist-app"));
```

API routes (`boundary.http.request`) always win over a static mount on the same
port, so `/admin/api/*` endpoints and the `/admin/*` SPA coexist cleanly. The
host re-derives mounts live when workflows change (deploy/disable).

`Filesystem` is a small, swappable interface (`LocalFilesystem`,
`MemoryFilesystem` ship; a flystorage adapter can drop in behind it) shared by
the app boundary and the admin's workflow store.

### Secret redaction

`secret()` tags a config field; `redactConfig(config, schema, extraPaths?)`
masks tagged fields **and** any path resolved from `$env`/`${VAR}` (the engine
tracks those at registration). Use `engine.redactedConfig(workflowId, nodeId)`
wherever config is surfaced — `formatGraph` already does.
