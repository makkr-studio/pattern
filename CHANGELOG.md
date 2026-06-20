# Changelog

All notable changes to the Pattern framework. The packages release together; a
version here applies across `@pattern-js/*` and `create-pattern` unless noted.

## 0.2.1

- **Docs handbook rooted at the mount.** The primary chapter (the handbook) now
  serves its pages directly under `/docs` (e.g. `/docs/getting-started`) instead
  of the doubled `/docs/docs/...`, so the intuitive URLs resolve. Other mods'
  chapters keep their slug prefix.
- LICENSE copyright set to Makkr Studio.

## 0.2.0 — Docs, DX & Agent Experience

A documentation, developer-experience, and agent-experience pass ahead of the
public release.

- **One documentation home.** The handbook, op reference, and every mod's chapter
  now live in `@pattern-js/mod-docs` (served at `/docs`, shipped as markdown in each
  package). The original root `docs/` folder and the `pattern-engine-spec.md` /
  `mod-admin-spec.md` design specs were retired — their durable content moved into
  the docs mod as the **Architecture** and **Admin internals** chapters.
- **A real learning path.** New Getting-started plus tutorials: authoring a
  workflow in the admin and in JSON, creating ops, serving a frontend app with
  workflows (the multi-instance / namespace model), and building a third-party mod.
- **Richer mod chapters & a complete op reference.** Every mod chapter gained
  "when to use / how / what to pair it with" guidance, and every op now carries
  "when to use" prose in the generated reference and `/docs/llms.txt`.
- **READMEs everywhere.** The root and every package — including the previously
  undocumented mods — now have current READMEs.
- **`create-pattern` scaffolds mods, not just apps.** A new top-level choice (app
  vs third-party mod) and a questionnaire (ops / workflows / admin page / docs);
  a mod's optional Tier-2 admin page is pre-wired with the admin's own stack
  (React + Tailwind + Motion + lucide), with a bring-your-own-stack opt-out.
- **Sharper AGENTS.md.** The template agent guides were audited for accuracy and
  the agent/chat ones fleshed out with full worked examples; the mod template ships
  its own mod-authoring guide.
- **Release flow simplified.** Changesets were dropped in favour of this
  hand-maintained changelog and direct version bumps.

## 0.1.x

The initial implementation of the engine, the Node adapter, the admin, and the
mod ecosystem, released as a lockstep `0.1.x` series.

### Engine & runtime (`@pattern-js/core`, `@pattern-js/runtime-node`)

- Runtime-neutral engine: typed ports/ops/workflows with Zod; load-time validation
  with human-readable, located errors; the scheduler (value barriers, control
  pulses, backpressured stream fan-out, skip propagation for branches, no
  topological sort); the full base op catalog; boundary contracts; hooks
  (priority / payload-threading / fail-fast / short-circuit / recursion-guard) and
  events; auth (`Principal` + provider chain); OTLP-shaped observability; the
  in-process transport.
- Node adapter: HTTP (buffered / SSE / chunked), WebSocket, CLI, and schedule
  hosts; a `node:worker_threads` pool transport with streamed results and
  cancellation; a socket-bound connection registry; JSONL and SQLite trace stores
  (durable run history + replay); the `pattern` CLI (`graph` / `validate` / `dev` /
  `run`); `loadProject`; mod loading.
- Storage on [flystorage](https://flystorage.dev) (`localFs` / `memoryFs`), shared
  by the app boundary and the admin's workflow store — a cloud adapter (S3 / GCS /
  Azure) is a one-line change.
- The app-serving boundary (`boundary.http.app`), the `FrontendContribution`
  surface, `engine.useAsync`, extensible services (`ctx.services`), the `secret()`
  /`redactConfig` masking, opt-in trace I/O sampling, and the serving-apps
  multi-instance / namespace routing.

### Admin (`@pattern-js/mod-admin`, `@pattern-js/admin-sdk`)

- A self-reflecting control surface where every endpoint is a workflow: control
  plane + filesystem-backed workflow store, content-addressed versioning with one
  live pointer per slug (instant rollback) and structural JSON diff, route-conflict
  cancel/swap on activation, an in-memory run/metrics sink.
- A React 19 + Vite + Tailwind v4 + `@xyflow/react` glassmorphism SPA: catalog,
  op browser, graph editor (connection assist, problems panel, save→version→deploy),
  runs with span waterfall / I/O peek / live SSE tail / on-canvas replay, versions
  + diff, system map, metrics.
- `@pattern-js/admin-sdk`: the typed client over the workflow-backed endpoints (incl.
  the SSE tail), the extension helpers, and the Tier-1 declarative / Tier-2 ESM
  remote page surface — proven by `@pattern-js/mod-sample` extending the admin with
  zero admin-core changes.

### Mods

- `@pattern-js/mod-identity` + `@pattern-js/mod-auth-magic-link` — users, revocable
  sessions, roles→scopes, a single-use token kernel, bootstrap-on-first-boot, and
  email magic-link login.
- `@pattern-js/mod-store` + `@pattern-js/mod-vault` — document collections with declared
  indexes, a blob store, CAS leases; and encrypted-at-rest secrets masked out of
  run samples.
- `@pattern-js/mod-agents` + `@pattern-js/mod-agents-openai` — the neutral agent
  contracts and turn protocol, tools-as-workflows, MCP servers, and the OpenAI
  provider with streaming, HITL approvals, and history compaction.
- `@pattern-js/mod-chat` — a complete chat application with a streaming transcript,
  HITL approvals, image input, refresh-recovery, and a forkable turn pipeline.
- `@pattern-js/mod-docs` — the self-reflecting documentation host.
