# Roadmap

Where Pattern is headed. This is a living document: it states direction, not
contract — order and scope shift as we learn. The [CHANGELOG](CHANGELOG.md)
records what actually shipped.

> **Pre-1.0 notice.** Pattern is greenfield. Minor releases may change APIs
> without migration paths or legacy shims; the CHANGELOG calls out every
> breaking change.

## Next — 0.5.0: durable by default (direction)

The headline candidate: **durable retries & resume** — retry policies as node
config, and resuming a failed run from the failing node instead of from
scratch. The event-sourced span log already records every node's I/O in
order; the work is resumable-state persistence and idempotency semantics (an
`email.send` must never replay). Alongside it, the scaffolder's composability
rework (surfaces × stacks × recipes, `pattern add`) is under consideration —
being shaped by real usage first.

## Later

An unordered shelf — these are on the map, not yet in a milestone:

- **Failure alerts** — a run fails, you get an email. Nearly free on `mod-email`.
- **Auth rate limiting** — throttle magic-link/invite issuance per address and
  IP; today a hostile client can make an app send email as fast as its driver
  allows.
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

- **0.4.0** — Buddy (the workflow assistant), the `pattern_*` control plane
  with scoped API tokens + MCP (HTTP and `pattern mcp` stdio), `mod-vectors`
  with hybrid filterable search, per-user chat memory with provenance
  receipts, and inbound email with threaded replies.
- **0.3.0** — the AI capability layer (`mod-ai`), the native agent loop, chat
  with voice, OIDC sign-in, and transactional email.
- **0.2.x** — the documentation home, the learning path, mod scaffolding.
- **0.1.x** — the engine, the Node runtime, the admin, and the first mod family.

Details for all of it in the [CHANGELOG](CHANGELOG.md). Have an idea or a wish?
[Open a discussion](https://github.com/makkr-studio/pattern/discussions).
