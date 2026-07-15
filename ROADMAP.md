# Roadmap

Where Pattern is headed. This is a living document: it states direction, not
contract — order and scope shift as we learn. The [CHANGELOG](CHANGELOG.md)
records what actually shipped.

> **Pre-1.0 notice.** Pattern is greenfield. Minor releases may change APIs
> without migration paths or legacy shims; the CHANGELOG calls out every
> breaking change.

## Next — 0.5.0: open for business (direction)

The theme: everything a real product needs the day it starts taking money.
Two headliners that are secretly one story — payments demand durability:

- **Durable execution** — retry policies as node config (attempts, backoff),
  resuming a failed run from the failing node instead of from scratch, and
  idempotency semantics so a retry can never double-send an email or
  double-charge a card. The deep engine work of the release; it also unlocks
  resumable approval gates in agent runs.
- **Payments (`mod-stripe`)** — checkout, the customer portal, and
  subscription state; a signed `stripe.webhook` trigger (the 0.4
  inbound-email recipe); and a subscription→identity bridge so plan status
  projects into roles — gating a route behind a paid plan becomes an auth
  requirement, not code. Plus **usage metering**: record agent and model
  usage to Stripe metered billing straight from the canvas.
- **The `saas-starter` pack + a deploy story** — scaffold sign-in, real
  email, billing, and a gated app in one command; a Dockerfile in every
  scaffold and guides for the usual platforms. From `npm create pattern` to
  a paying customer.
- **Failure alerts** — a run exhausts its retries, you get an email. Nearly
  free on `mod-email`, and it completes the reliability story durability
  starts.

The scaffolder's composability rework (surfaces × stacks × recipes,
`pattern add`) stays under consideration — being shaped by real usage first.

## Later

An unordered shelf — these are on the map, not yet in a milestone:

- **Orgs & teams** — multi-tenant identity: organizations, team invites,
  per-org data scoping and billing. The natural sequel to a SaaS that takes
  money.
- **Durable timers & waits** — once durability lands: nodes that sleep for
  days (drip campaigns) or wait for an event or approval (human-in-the-loop)
  without holding a process open.
- **Auth rate limiting** — throttle magic-link/invite issuance per address and
  IP; today a hostile client can make an app send email as fast as its driver
  allows.
- **Workflow import/export & a public gallery** — copy-as-JSON, import-from-URL,
  and a gallery of ready-to-import examples on the site.
- **`pattern test`** — a workflow test harness: fixtures in, assertions out,
  trace snapshots.
- **Typed clients** — generate a TypeScript client for your app's endpoints from
  the boundary schemas.
- **Document readers** — a text-extraction seam (PDF first) feeding
  `mod-vectors` ingestion and file uploads in chat.
- **Postgres drivers** — pgvector for vectors first; store and traces later,
  so production can run on one database.
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
