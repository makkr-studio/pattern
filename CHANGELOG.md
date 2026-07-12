# Changelog

All notable changes to the Pattern framework. The packages release together; a
version here applies across `@pattern-js/*` and `create-pattern` unless noted.

## 0.4.0 — unreleased

The framework learns to build itself: Buddy (the in-editor workflow
assistant), a scoped-token control plane with a Pattern MCP server, vector
search, and inbound email.

### Buddy & the control plane

- **`@pattern-js/mod-buddy` — Buddy, the workflow assistant.** A chat dock in
  the editor (the ✦ toggle; appears only when the mod is installed): describe
  what you want and Buddy drafts the workflow — grounded in your app's
  handbook + op catalog, validated before you ever see it — then **applies
  proposals to your open canvas** as ordinary, undoable edits. It debugs
  failed runs from traces ("why did this break at 3am?"), remembers the
  conversation per workflow (mod-store), runs on the `buddy` model alias when
  defined (else the default), and its whole turn pipeline is an editable
  Pattern workflow. When a recent run failed, the dock offers the question as
  a one-click chip — *Why did "daily-digest" fail 3m ago?* — instead of making
  you type it; consecutive calls of the same tool collapse into one chip with
  a `+n` badge.
- **The `pattern_*` control plane: ten restricted tool workflows** (list/get
  ops, search docs, get workflow, validate, propose, save-draft,
  deploy-with-approval, list/get runs) — one capability layer consumed by
  Buddy, by external MCP clients, and by the CLI. `boundary.tool` gains
  `restricted: true`: excluded from EVERY `["*"]` expansion (agent toolsets
  and MCP alike), offered only by explicit name.
- **Scoped, revocable API tokens** (`@pattern-js/mod-identity`): `pat_…`
  bearer credentials minted in admin → Access → API tokens (show-once, hashed
  at rest), with a six-scope taxonomy — `workflows:read`/`workflows:write`,
  `runs:read`/`runs:write`, `deploy`, `admin` (root) — so an authoring token
  can draft all day and still can't touch production. The `admin.*` ops
  re-check scopes in-op (advisory-open without an auth provider, mirroring
  `engine.authorize`), and NEW `admin.workflow.validate` returns located
  issues without saving.
- **The Pattern MCP server.** `POST /mcp/pattern` (seeded by mod-buddy,
  token-gated) serves the ten tools to Claude Code, Cursor, or any MCP
  client; **`pattern mcp`** serves the same over stdio for local dev — no
  tokens, your shell owns the box. `ai.mcp.serve`'s `tools/call` now enforces
  the same exposure set as `tools/list`, and `mcpServerWorkflow()` accepts an
  `auth` requirement.

### Vector search

- **The chat remembers you — with receipts.** With mod-vectors + an
  `embeddings` alias installed, mod-chat grows cross-conversation, per-user
  memory: after each completed turn an event-triggered, forkable workflow
  (`chat.memory.pipeline`) extracts the durable facts about the user and
  indexes them filter-pruned by `userId`; the next turn — in any conversation
  — recalls the most relevant ones into the system prompt. Every memory
  carries provenance (`{ userId, conversationId, sourceRunId }`): admin →
  Chat → **Memories** shows what the assistant knows about whom, with a
  **Source run** link to the exact moment it was learned and a **Forget**
  button. Signed-in users only; `memory: false` turns it off; everything is
  duck-typed, so without vectors chat runs unchanged. `VectorsService` gains
  `list()` (row enumeration for browsers like this one), and the sink emits a
  `chat.turn.completed` event anything can subscribe to.
- **Memory that revises itself.** Extraction is a *reconciliation*: the model
  sees the user's existing nearby memories and answers with operations —
  `add` / `supersede` (with `revises` lineage) / `forget` — so contradictions
  resolve at write time instead of piling up; ids are validated against the
  fetched set, a per-user cap (default 200) bounds growth, recall runs under
  a hard ~300-token prompt budget, and a `memory` alias routes extraction to
  a mini model. The agent also gets a visible **`remember` tool** — the user
  watches it decide to remember, and the memory's receipt is the tool call's
  own run.
- **The admin's Vectors page is now the whole RAG loop**: collections table +
  **Ingest text** (paste → chunk → embed; collection created on first use,
  content-hash dedupe on re-paste) + **Search** (hybrid, scored matches).
  Testing retrieval is a form, not a curl. Tier-1 forms gained
  `format: "multiline"` (a textarea) along the way.

- **`@pattern-js/mod-vectors` — embedding collections.** A collection
  **declares its embedding alias** and locks its dims on first write, so
  indexing with one model and querying with another is unrepresentable.
  Declared **filterable meta fields** land in an indexed side table and prune
  BEFORE scoring (`filter: { field: value | values[] }`; undeclared fields are
  located errors). `vectors.query` ranks in three modes — cosine, keyword
  (FTS5 when available, token-overlap fallback), and **hybrid** via
  reciprocal-rank fusion. `vectors.index` is chunk→embed→upsert in one node,
  content-hashed so unchanged docs cost nothing. Zero-dependency sqlite
  engine (durable AND offload-safe); a driver SPI carries `{filter, mode}`
  for sqlite-vec/pgvector later. Admin: Data → Vectors.
- Buddy dogfoods it: with mod-vectors + an embedding alias installed, a boot
  indexer embeds the live handbook and `buddy.knowledge.search` silently
  upgrades from lexical to hybrid semantic retrieval — same output shape.

### Email

- **Inbound email.** The `email.inbound` trigger runs a workflow once per
  received message (per-account filtering); attachments land in the blob
  store as references. `@pattern-js/mod-email-resend` ships a signed webhook
  (svix scheme, hand-rolled on node:crypto: constant-time, ±5 min window,
  raw-bytes verification over a `bodyMode: "stream"` route) at
  `POST /email/inbound/resend`.
- **`email.reply`** answers an inbound message with real threading —
  In-Reply-To/References, `Re:` prefixed exactly once, reply-to respected —
  and `EmailMessage` gains pass-through `headers`. Email your app a question;
  a three-node workflow answers in-thread.

### Identity

- **Invite emails carried a relative (dead) link** — fixed at the root:
  `PATTERN_PUBLIC_URL` is the app's canonical origin, and every delivered link
  (invite, magic link) is built on it — it beats the request-derived origin,
  because proxies and tunnels lie about Host. Without it, the invite route now
  wires the request URL through (new core `fromRequestUrl()` port source), so
  dev links are absolute too. The bootstrap console link uses it as well.
- **Invites are records now**: admin → Access → **Invites** sends (email,
  roles, and a **next path** — where the first login lands) and lists every
  invite with a derived status (`pending` / `accepted` / `expired` /
  `revoked`). Revoking a pending invite kills its link immediately — the
  callback checks the record before creating any account. Ops:
  `identity.invites.list` / `identity.invites.revoke`.
- **Accepting an invite no longer silently signs you in.** The link creates
  the account and lands on `/auth/invited` — "your account is ready, sign in
  for the first time" — handing the invite's next path into the login screen.
  Acceptance and first sign-in are two acts again.
- **Real user administration**: delete a user (`identity.users.delete` —
  sessions revoked, user + identity links + session rows removed), edit roles
  from the user's details page (the setRoles op finally has a route + UI),
  disable/enable stays reversible. Guards everywhere they matter: no
  self-disable/self-delete, and the **last active admin** can't be demoted,
  disabled or deleted.
- Tier-1 admin forms on parameterized pages now carry the page's `:params`
  into their submit — what makes the "Set roles" form on `/x/identity/users/:userId`
  (and any future mod's detail-page form) possible.
- **Token emails read like a human wrote them.** The `identity.deliverToken`
  payload now carries ready-made, purpose- and expiry-aware copy (`subject`,
  `message`, `expiresAt`) — "You've been invited … valid for 7 days" instead
  of "Your invite link — click the button to continue". Identity owns the
  wording (it knows the token's semantics), so every channel on the hook —
  the packaged email workflow included — gets it for free, and a forked
  workflow can still write its own.
- OIDC's `redirect_uri` adopts `PATTERN_PUBLIC_URL` too: the IdP has the
  public address registered, and behind a proxy the Host header is not it.

### Core

- **Any mod can ship a trigger op.** `OpDefinition.triggerEvents(config)`
  declares event subscriptions the engine wires at registration (how
  `email.inbound` works — zero host changes), and `outgateOptional` replaces
  the validator's hardcoded out-gate exemption (also fixing
  `boundary.ws.close`, which could never reach a meaningful out-gate).
- `secretRefSchema` + `resolveSourced` hoisted to core (one sourced-secrets
  implementation for mod-ai, mod-email, mod-vectors); `admin` is now the root
  scope in `meetsRequirement`.
- **Mod load order can't break seeded workflows.** `loadMods` parks every
  mod-contributed workflow during install and registers them once ALL mods'
  ops are in (`useAsync({ deferWorkflows })` +
  `engine.flushDeferredWorkflows()`), so a mod's seeded workflow may wire
  ops from a mod listed after it — mod-buddy's `pattern_*` tools wire
  `docs.*` ops while mod-docs sits last in a scaffolded config. The same
  deferral `ready` hooks always had.

### Scaffolder

- `studio-ai` adds mod-vectors; `agentic` and `agent-chat` add mod-vectors +
  mod-buddy. The agentic examples gain a **RAG pair**: `POST /rag/ingest`
  (declare + chunk + embed) and `POST /rag/ask` (hybrid retrieval → grounded
  answer with sources).
- **Provider picks seed model aliases.** Choosing e.g. OpenAI pre-writes
  `default` (language) and `embeddings` (embedding) into
  `.pattern-data/ai-config.json`, each authenticating through an env-sourced
  secret reference (`{ source: "env", key: "OPENAI_API_KEY" }` — never a
  value). A fresh scaffold answers `/rag/ask` and talks to Buddy the moment
  the key lands in `.env`; re-point the aliases anytime in Settings.
- **`.mcp.json` in the Buddy packs** (`agentic`, `agent-chat`): `npx pattern
  mcp` is pre-wired, so opening the scaffold in Claude Code (or any MCP
  client reading `.mcp.json`) hands it the `pattern_*` control-plane tools
  with zero setup — plus a new AGENTS.md ground rule telling coding agents to
  prefer them over guessing.
- **Inbound email demo**: `agentic` with Resend delivery scaffolds
  `workflows/email-agent-reply.json` — `email.inbound` → agent → threaded
  `email.reply`, ready for a Resend webhook pointed at
  `POST /email/inbound/resend`.
- The Buddy packs always ship `/docs`: mod-buddy's tools and knowledge read
  mod-docs, so `agentic`/`agent-chat` skip the docs question and `--no-docs`
  earns a note instead of an app that can't boot.
- Next-steps cards now cover the seeded aliases (and the env key that unlocks
  them), the Buddy toggle, the Claude Code hookup, and the RAG curl pair; the
  manifest card lists the seeded config and `.mcp.json` under *generates*.
  Scaffold-written workflows (`whoami`, `email-agent-reply`) get the same
  op-drift CI safety net as template workflows.

## 0.3.0 — 2026-07-02

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
