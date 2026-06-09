---
"@pattern/admin-sdk": minor
"@pattern/runtime-node": patch
---

Initial `@pattern/admin-sdk` (framework-agnostic core) + a HTTP shutdown fix.

- **@pattern/admin-sdk** — the stable extension surface (mod-admin-spec §6, §12):
  the wire-protocol DTOs, a typed `createAdminClient()` over the workflow-backed
  endpoints (including the SSE run tail as an async iterable), and the extension
  helpers (`buildNav`, `MenuRegistry`, `CommandRegistry`, `defineDeclarativePage`).
  React-free and verified end-to-end against the live mod-admin backend. The
  React hooks + glass UI kit land with the SPA, built on this core.
- **@pattern/runtime-node** — `HttpHost` now tracks live sockets and force-closes
  them on shutdown, so `close()` is deterministic even with an open SSE stream
  (e.g. the admin's live run tail).
