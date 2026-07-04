# Roadmap

Where Pattern is headed. This is a living document: it states direction, not
contract — order and scope shift as we learn. The [CHANGELOG](CHANGELOG.md)
records what actually shipped.

> **Pre-1.0 notice.** Pattern is greenfield. Minor releases may change APIs
> without migration paths or legacy shims; the CHANGELOG calls out every
> breaking change.

## Next — 0.4.0: the framework learns to build itself

0.3.0 put the whole loop on the canvas. 0.4.0 turns Pattern's introspection —
a self-describing op catalog, a validator with located errors, content-addressed
workflow versions, event-sourced run traces — into things that *author and
explain workflows for you*.

### 🪄 Buddy, the workflow assistant in the admin

A chat dock in the editor that builds with you: describe what you want, and
Buddy drafts the workflow — repairing its own mistakes against the validator
until the graph is clean. It reads the op catalog and the handbook through
retrieval, inspects failed runs straight from the trace store ("why did this
break at 3am?"), and **applies proposals to your open canvas** as ordinary,
undoable edits. The human keeps the save and deploy buttons: you review the
change on the canvas before anything ships, and rollback stays instant. Buddy
runs on a configurable model alias — any provider — and, naturally, Buddy
itself is built from Pattern workflows.

### 🔌 Control-plane tools & the Pattern MCP server

Buddy's toolset — search the catalog, read a workflow, validate a draft,
save a version, deploy, inspect runs — ships as ordinary tool workflows, and an
MCP server exposes them to the outside world. `pattern mcp` serves stdio for
local development (Claude Code, Cursor — your editor's agent becomes a Pattern
author); HTTP mode is guarded by **scoped, revocable API tokens** with an
author/deploy split, so a token that can draft workflows still can't touch what
runs in production.

### 🧭 Vector search (`mod-vectors`)

Embedding collections for the store: `upsert` / `index` / `query` ops plus text
chunking, with ingestion pipelines that run visibly on the canvas. A collection
**declares its embedding alias and dimensions**, so querying with a different
model than you indexed with becomes unrepresentable — the classic RAG bug,
designed out. A zero-dependency local engine is the default; a driver SPI keeps
the seam open for sqlite-vec, pgvector, and friends. Comes with the showcase to
match: RAG over your own documents, grounded chat included.

### 📬 Inbound email

The `mod-email` contract learns to receive: an `email.inbound` trigger
(address and plus-tag matching), a signature-verified Resend webhook driver,
attachments landing in the blob store, and `email.reply` with proper threading.
Email your app a question — an agent reads it, calls its tools, and answers.

## Later

An unordered shelf — these are on the map, not yet in a milestone:

- **Durable retries & resume** — retry policies as node config; resume a failed
  run from the failing node, built on the event-sourced replay log.
- **Failure alerts** — a run fails, you get an email. Nearly free on `mod-email`.
- **Workflow import/export & a public gallery** — copy-as-JSON, import-from-URL,
  and a gallery of ready-to-import examples on the site.
- **Deploy story** — Dockerfile in every scaffold and guides for the usual
  platforms; from `npm create pattern` to a URL in minutes.
- **`pattern test`** — a workflow test harness: fixtures in, assertions out,
  trace snapshots.
- **Typed clients** — generate a TypeScript client for your app's endpoints from
  the boundary schemas.
- **Payments** — a Stripe mod, completing identity + email into a `saas-starter`
  modpack.
- **More vector drivers** — pgvector first.
- **Hosted docs** — the handbook, online at pattern-js.dev.
- **Community mod registry** — discover third-party mods by npm keyword.

## Shipped

- **0.3.0** — the AI capability layer (`mod-ai`), the native agent loop, chat
  with voice, OIDC sign-in, and transactional email.
- **0.2.x** — the documentation home, the learning path, mod scaffolding.
- **0.1.x** — the engine, the Node runtime, the admin, and the first mod family.

Details for all of it in the [CHANGELOG](CHANGELOG.md). Have an idea or a wish?
[Open a discussion](https://github.com/makkr-studio/pattern/discussions).
