---
"@pattern/mod-admin": minor
"@pattern/admin-sdk": minor
"@pattern/core": patch
---

The admin SPA (mod-admin-spec M4–M9) + the endpoints/contract it needs.

- **@pattern/mod-admin** — a React 19 + Vite 8 + Tailwind v4 glassmorphism SPA
  under `src/app`, built to `dist-app/` and served via `boundary.http.app`
  (`adminMod()` serves the bundle by default). Shell with manifest-driven nav,
  dark/light, ⌘K palette; Catalog; Op browser; an `@xyflow/react` graph editor
  (nodes from `OpInfo`, kind-colored edges, palette add, connection assist via
  `admin.ports.compatible`, JSON config inspector, save→version→deploy, problems
  panel); Runs (span waterfall + I/O peek + live SSE tail); Versions + JSON diff +
  promote/rollback; System map; Metrics. New backend ops `admin.ui.manifest` and
  `admin.system.map` (+ endpoints).
- **@pattern/admin-sdk** — `uiManifest()` / `systemMap()` client methods + their
  protocol types.
- **@pattern/core** — `PageDef` gains a serializable `{ path, remote }` (Tier-2
  ESM-remote-by-URL) variant.
