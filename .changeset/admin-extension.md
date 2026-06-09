---
"@pattern/mod-admin": minor
"@pattern/admin-sdk": minor
"@pattern/mod-sample": minor
---

The admin extension surface + its proof (mod-admin-spec M10).

- **@pattern/mod-admin** — `admin.invoke` op/endpoint (runs a source op one-shot,
  backing declarative pages); the SPA gains a `DeclarativeView` renderer
  (table/json/markdown/chart/graph/iframe) and a `ManifestPage` that mounts
  mod-contributed pages by path — Tier-1 declarative views and Tier-2 ESM remotes
  loaded at runtime (React shared via `window.__PATTERN_ADMIN__`).
- **@pattern/admin-sdk** — `invoke(source, input?)` client method.
- **@pattern/mod-sample** *(new)* — a throwaway sample mod that adds a Tier-1
  page, a ⌘K command, a menu entry, and a self-served Tier-2 ESM remote with zero
  admin-core changes. The thesis test: installing it extends the admin.
