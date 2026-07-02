# Changelog

All notable changes to the Pattern framework. The packages release together; a
version here applies across `@pattern-js/*` and `create-pattern` unless noted.

## 0.3.0 — unreleased

The AI, sign-in & email release: a native agent loop over any provider, a chat
app with voice, real login methods, and transactional email — plus a full
polish pass on the scaffolder, docs, and landing surfaces.

### AI & agents

- **`@pattern-js/mod-ai` — the AI capability layer.** Every modality as ops —
  `ai.text.generate/stream`, `ai.object.generate`, `ai.embed(.many)`,
  `ai.image.generate`, `ai.speech.generate`, `ai.transcribe`,
  `ai.video.generate` — over the full Vercel AI SDK provider catalog (40+
  providers, lazy-loaded; the AI Gateway built in). Models are **aliases**:
  admin-configured instances (provider + model id + a vault/env-sourced key)
  resolved by name at run time, so re-pointing one in Settings retargets every
  workflow. A generated **AI Providers** settings page, `ai.mcp.client` for
  remote MCP tools, and an `ai.mcp.server` route exposing your tool workflows
  to MCP clients.
- **`@pattern-js/mod-agents` rebuilt on a native loop.** The agent run loop is
  Pattern code (no external agents SDK): `agents.agent` / `agents.run` /
  `agents.run.resume`, tool workflows with engine-validated params, guardrails,
  HITL approvals, history compaction — with agent name & instructions as
  runtime inputs. `@pattern-js/mod-agents-openai` is retired; mod-agents +
  mod-ai replace it on any provider.
- **Declarative asset mounts & internal workflows.** Mods can declare static
  asset mounts; plumbing routes can mark themselves `internal` to keep the
  admin catalog focused (the "show internal" toggle reveals everything).

### Chat

- **Voice.** In-browser speech-to-text (Silero VAD + local Whisper assets),
  spoken-style agent instructions on voice turns, text-to-speech playback, and
  a fullscreen WebGPU particle **voice avatar** (Canvas2D fallback).
- **Per-turn model switcher** backed by language-model aliases
  (`chat.model.resolve` layers a per-turn pick over the pinned/default model).
- **Multi-instance serving.** One shared chat backend, many branded SPA
  instances (namespace decoupled from path); per-namespace agents by forking
  the turn pipeline alone — most-specific route wins.
- A three-way theme, lucide icons, avatar polish, and image/STT/TTS tools
  (`chat.tool.image`, transcribe/speech routes) with conventional aliases.

### Sign-in & email

- **`@pattern-js/mod-email` — the transactional-email contract.**
  Admin-configured **accounts** (provider + from + vault/env-sourced secrets)
  under System → Email, an `email.send` op (markdown body with an inline-styled
  HTML render + text alternative, attachments from blobs or literals), and a
  packaged `email.deliver-token` workflow: create the `default` account and
  identity sign-in links send themselves — console fallback until then, and on
  any delivery failure (never locked out).
- **`@pattern-js/mod-email-resend` / `mod-email-smtp`** — the first two
  drivers (plain-fetch Resend; nodemailer SMTP with pooled, digest-keyed
  transports). Drivers self-register; their field lists auto-generate the
  admin account form, with a real-send **Test** button.
- **`@pattern-js/mod-auth-oidc` — OIDC login.** Authorization-code + PKCE
  against any OpenID Connect issuer (Google, Microsoft, Keycloak, …), ID
  tokens verified with jose, several providers side by side, sessions minted
  by mod-identity. Linking is by **verified email only** (configurable), so an
  IdP can't take over an existing account with an unverified claim. Code-
  configured via a small wrapper mod; the login page renders every registered
  method, and OIDC failures surface as human-readable messages.

### Scaffolder (`create-pattern`)

- **Sign-in methods choice**: magic link, OIDC, or both (`--oidc`,
  `--magic-link`); OIDC scaffolds a commented `mods/oidc.mjs` wrapper +
  `.env` hints. **Sign-in link delivery** choice: console, Resend, or SMTP
  (`--email`).
- New **`studio-ai`** modpack (Studio + AI ops, no agent loop) and a
  `--providers` picker for the AI packs.
- `--help`, validated flag values, notes for flags a selection can't use
  (instead of silently ignoring them), a ladder note generated from the real
  pack list, and `--no-examples` cleaned up across every pack.
- Scaffolds now **derive their `@pattern-js/*` dep ranges from the CLI's own
  version**, so a fresh project always resolves the mods published alongside
  the `create-pattern` it ran (templates can no longer go stale across a
  minor bump).

### Docs, admin & site

- Four new chapters (OIDC login, Email, Resend, SMTP) slot between the
  identity and AI clusters; identity docs cover the new login method and the
  packaged email delivery; getting-started documents the new scaffold
  dimensions.
- Catalog presentation: chat's CRUD plumbing is internal by default, the
  approval pipeline and MCP server gained descriptions + hand-laid layouts,
  and every visible auth/email route describes itself.
- The README and the site tell the 0.3 story (identity + email cards, the
  `studio-ai` modpack, honest op counts: 175 base ops, over 300 with the
  first-party mods).

## 0.2.2

A pipeline and polish release; no functional changes to the published packages.

- **The marketing site ships from CI.** The `site/` workspace now deploys to
  Cloudflare Pages: every push to `main` refreshes a staging preview, and a
  release tag publishes production. A tag ships the npm packages and the
  production site together, so the site's version badge always tracks the
  released framework version.
- A more playful Konami easter egg on the site (the page "runs itself").

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
