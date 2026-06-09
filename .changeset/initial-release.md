---
"@pattern/core": minor
"@pattern/runtime-node": minor
"create-pattern": minor
---

Initial implementation of the Pattern execution engine.

- **@pattern/core** — runtime-neutral engine: typed ports/ops/workflows with Zod;
  load-time validation with human-readable errors; the scheduler (value barriers,
  control pulses, backpressured stream fan-out, skip propagation for branches, no
  topological sort); the full base op catalog (~158 ops); boundary contracts;
  hooks (priority/threading/fail-fast/short-circuit/recursion-guard) and events;
  auth (Principal + provider chain); OTLP-shaped observability; in-process transport.
- **@pattern/runtime-node** — HTTP (buffered/SSE/chunked), WebSocket, CLI, and
  schedule hosts; `node:worker_threads` pool transport with streamed results and
  cancellation; socket-bound connection registry; JSONL/SQLite trace sinks; the
  `pattern` dev CLI (graph/validate/dev); mod loading.
- **create-pattern** — interactive scaffolder with non-TTY degradation and the
  hello-workflow / http-api templates (JSON workflows, declarative HTTP, mods).
