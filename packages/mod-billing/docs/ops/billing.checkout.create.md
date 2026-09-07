Create a hosted checkout session and output its `url` — wire it into
`boundary.http.response`'s redirect and the provider hosts cards, taxes and
3DS. Two modes, one node:

- **`mode: "subscription"`** (default) — recurring. The subscription's state
  arrives on `subscription.*` events and grants the entitlement role while it
  stays paid.
- **`mode: "payment"`** — one-time. The completed checkout is recorded as a
  **purchase**, `billing.owns` answers for it, and a `grants` entry in the mod
  options turns it into a role the buyer keeps.

`userId` becomes the session's reference: the completion webhook uses it to map
the new provider customer back to your user, which is what makes the
entitlement bridge work — always wire the trigger's `user.id` here. `priceKey`
(config or input) names the price — a **lookup key** like `pro` or `lifetime`
(set on the price in the provider's dashboard; the same key works in test and
live) or a `price_…` id — and falls back to the account's `defaultPriceKey`.
Redirect URLs anchor on PATTERN_PUBLIC_URL (the wired `origin` is the fallback
for local dev), and `next` (config or input, relative-path guarded) rides them
as `?next=` so the packaged return pages forward the buyer back to the gated
page this checkout started from; a one-time checkout also puts its `item` on
the success URL so that page waits for the purchase, not a subscription.

Retries are provider-side idempotent: the idempotency key is pinned to the
node within its run *lineage* (`ctx.rootRunId`), so a retried attempt — and a
node re-executed by a durable **Resume** — replays the same session instead of
minting another. A re-run from start is a new lineage and a new session, on
purpose. Setup failures (no account, no price, an unresolvable secret, an
unknown lookup key) carry the no-effect verdict, so resume re-runs them without
asking.
