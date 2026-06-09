---
"@pattern/core": minor
"@pattern/runtime-node": minor
---

Engine prerequisites for the admin mod (mod-admin-spec §2).

- **@pattern/core**
  - `boundary.http.app` op contract (P1) — an app-serving boundary, exempt from
    the out-gate requirement.
  - `FrontendContribution` + `PatternMod.frontend`; `engine.frontend()`
    aggregation and `engine.installedMods()` (P2).
  - `engine.useAsync(mod)` runs the resolve phase for config-port workflows (P3).
  - Extensible services: `engine.provideService(name, impl)` / `engine.service(name)`,
    reachable by ops as `ctx.services.<name>`.
  - `secret()` Zod tag + `redactConfig()` + `engine.redactedConfig()`; env-derived
    config paths tracked at registration and masked; wired into `formatGraph` (P4).
  - Trace I/O sampling: `SpanData.io` / `IoSample`, opt-in via `run({ sampleIo: true })`,
    bounded + maskable, off by default (T1).
  - `portCompatibility(from, to)` — single source of truth for edge validity (T2).
  - Workflow `description`/`tags`/`source` and per-node `ui` (data-only) (T3).
- **@pattern/runtime-node**
  - HTTP host serves `boundary.http.app` mounts (static assets + SPA fallback +
    immutable caching), with API routes taking precedence on the same port and
    live re-derivation on workflow changes.
  - `Filesystem` abstraction (`LocalFilesystem`, `MemoryFilesystem`) + a
    `FilesystemRegistry` engine service (`provideFilesystem`).
