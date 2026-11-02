# Roadmap

Where Pattern is headed. This is a living document: it states direction, not
contract — order and scope shift as we learn. The [CHANGELOG](CHANGELOG.md)
records what actually shipped.

> **Pre-1.0 notice.** Pattern is greenfield. Minor releases may change APIs
> without migration paths or legacy shims; the CHANGELOG calls out every
> breaking change.

## Next

The next milestone is being shaped by real usage of 0.5. It will come from the
shelf below; orgs & teams and durable timers & waits are the front-runners.

## Later

An unordered shelf — these are on the map, not yet in a milestone:

- **Orgs & teams** — multi-tenant identity: organizations, team invites,
  per-org data scoping and billing. The natural sequel to a SaaS that takes
  money.
- **Durable timers & waits** — once durability lands: nodes that sleep for
  days (drip campaigns) or wait for an event or approval (human-in-the-loop)
  without holding a process open.
- **Shared rate-limit counters**: the 0.5 limits count per process (the
  per-address sign-in budget already lives in the identity store); a store
  seam would let a fleet share one budget.
- **API tokens that end with their minter**: an opt-in policy that revokes
  the `pat_` tokens an admin minted when that admin is demoted, disabled or
  deleted. Today tokens are app credentials and outlive their creator.
- **Billing and durability edge cases**: a rerun executes with the original
  run's principal (re-check it against the current roles); billing's role
  projection can race a concurrent admin role edit (make it a CAS write); a
  `subscription.updated` for a second subscription replaces the tracked one
  (track several per customer); events stamped in the same second can apply
  out of order (order by the provider's sequence).
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

- **0.5.0** — open for business: durable execution (retry as node config,
  the RunLedger, resume and re-run that never repeat completed work, external
  effects sealed or confirmed), a payments contract with a Stripe driver
  (subscriptions and one-time purchases projected into roles, the customer
  portal, signed webhooks), AI usage metering, failure alerts, the
  `saas-starter` pack with a Dockerfile in every scaffold, compose mode with
  `pattern add`, sign-in codes, and an admin reorganized around six rooms.
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
