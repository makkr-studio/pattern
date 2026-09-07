# Billing

`@pattern-js/mod-billing` makes your app **take money** — recurring
subscriptions and one-time purchases alike: hosted checkout and the customer
portal as ordinary ops, a normalized webhook event stream you can build
workflows on, and a payments → roles bridge that turns "paid feature" into a
plain `requireAuth` scope. It is the CONTRACT mod — provider mods plug in
underneath (`@pattern-js/mod-billing-stripe` first; the union is
provider-neutral so a `mod-billing-revolut` slots in without touching your
workflows).

## The two-minute version

| You want | Checkout node | The gate | Mid-graph check |
|---|---|---|---|
| A subscription (recurring) | `billing.checkout.create` with `mode: "subscription"`, `priceKey: "pro"` | `entitlement: { role: "member" }` → role while paid → `requireAuth: { scopes: ["pro"] }` | `billing.entitled` |
| A one-time purchase | `billing.checkout.create` with `mode: "payment"`, `priceKey: "lifetime"` | `grants: { lifetime: "member" }` → role for good → the same `requireAuth` | `billing.owns` |
| Something on payment | — | — | a `billing.event` trigger: `purchase.completed`, `subscription.updated`, `invoice.payment_failed` |

Price keys are the provider's **lookup keys** (`pro`, `lifetime`) — names you
give prices in the dashboard — so config never carries a `price_…` id and
test → live is a no-op. The saas-starter ships both flows
(`workflows/checkout.json`, `workflows/buy.json`) behind one gated page.

```jsonc
{ "mods": ["@pattern-js/mod-billing", "@pattern-js/mod-billing-stripe"] }
```

## Accounts: names, never secrets

Like email, billing speaks in **accounts** — memorable names bound to a driver
plus *sourced* secrets (`{"source":"vault","key":"STRIPE_API_KEY"}` — the
default; an env ref is the alternative — never a value). Paste the keys in
**admin → Resources → Secrets**, configure the account in **admin → System →
Billing**; ops fall back to the `"default"` account. Re-pointing an account
re-targets every workflow that uses it.

## Checkout and the portal are one node each

```
billing.checkout.create  { userId, email? } → { url }   // redirect the browser
billing.portal.create    { userId }         → { url }   // manage/cancel
```

Wire `url` into `boundary.http.response`'s redirect and you have a payment UI:
the provider hosts cards, taxes, and 3DS. `userId` rides along as the
checkout's reference, so the completion webhook can map the new provider
customer back to *your* user. Redirect URLs anchor on `PATTERN_PUBLIC_URL`
(set it behind a proxy) with `/billing/success` and `/billing/cancel` paths
you can change in the mod options.

## Recurring or one-time: `mode` on the checkout

The same node sells both. `mode: "subscription"` (the default) starts a
recurring plan whose state arrives on `subscription.*` events for as long as
it lives. `mode: "payment"` sells something **once**: the completed checkout
is recorded as a **purchase** (`billing.purchases` — who, what, how much, the
session id as its key so a redelivery never double-records), the price key is
marked as *owned* on the customer mapping, and a `purchase.completed` event is
emitted with the details. `billing.owns` answers "does this user own X?" from
the mapping; the Billing page lists every sale.

Name prices by **lookup key** (`priceKey: "lifetime"` on the node, or the
account's `defaultPriceKey`). One-time buyers become provider customers too, so
they can reach the portal for receipts, and both kinds of payment land in the
same customer row.

## The return pages absorb the webhook race

The provider redirects the buyer to `/billing/success` the moment payment
settles — usually **before** the completion webhook has granted the role. The
mod serves both return paths itself, so that moment is honest instead of a
404:

- **success** greets the buyer and polls `/billing/status` until the webhook
  flips `entitled` (a subscription) or records the bought `item` (a one-time
  purchase — its price key rides the return URL), then forwards to `next` —
  the gated page checkout was started from. Already unlocked → an immediate
  redirect; not signed in → a static thank-you.
- **cancel** reassures that no charge was made and points back.
- **`/billing/status`** answers `{ signedIn, entitled, status, purchased }`
  for the *calling* user (principal-derived — it can't probe anyone else),
  which any frontend can also use to pick between "Upgrade", "Manage
  subscription", and "You own this".

Give `billing.checkout.create` a `next` (config or input, relative-path
guarded) and it rides the return URLs as `?next=`. Want your own pages? Move
the paths in the options, or set `pages: false` and serve them yourself.

## The webhook: verify → dedup → map → project → emit

The driver mod seeds a signed webhook route. Every delivery is:

1. **verified** against the account's signing secret (raw bytes, constant-time),
2. **claimed** by the provider's stable event id (needs `@pattern-js/mod-store`).
   Providers redeliver on timeouts, and a double-processed `checkout.completed`
   is a support ticket with money in it — but a delivery that *failed*
   mid-projection must not become a permanent "duplicate" either. So the row
   carries a state: `processing` → `processed` (a redelivery is acknowledged,
   never re-projected) or `failed` (the redelivery reprocesses it). A twin
   still in flight is answered **409**, so the provider retries instead of
   being told all is well. The admin's Events table shows the state and the
   attempt count.
3. **folded into the customer mapping** (`billing.customers`): user ↔
   provider-customer, subscription status and prices, entitlement, and the
   prices bought outright — browsable in the admin. A payment-mode checkout
   also writes its **purchase** row. Deliveries for one customer are
   serialized, and state-bearing events (`subscription.*`) are ordered by the
   provider's event time: a delayed older `active` arriving after a `deleted`
   is recorded as `stale`, never projected — canceled stays canceled.
4. **projected into roles** (below), and
5. **emitted** as a normalized `billing.*` event — plus `purchase.completed`
   for a one-time sale.

The `billing.event` trigger subscribes to those events, so *"on payment
failed → email the user"* or *"on purchase → provision"* is an ordinary
three-node workflow — filter with `config.kind` or take all six kinds.

## Payments become roles: `entitlement` and `grants`

With `@pattern-js/mod-identity` installed, billing manages roles from the
mapping — and only the roles it is told about, leaving every other role alone:

- **`entitlement: { role }`** — any entitled subscription (`active`/`trialing`,
  plus `past_due` under `gracePastDue`) grants the role (default `member`);
  losing it removes the role.
- **`grants: { priceKey: role }`** — per price. A price **bought outright**
  grants its role for good; a price on an **entitled subscription** grants its
  role while the subscription is entitled. This is how tiers work
  (`{ pro: "member", team: "team" }`) and how a one-time purchase unlocks a
  feature (`{ lifetime: "member" }`).

Identity compiles roles → scopes per request, so gating a route behind a paid
plan — subscribed or bought — is:

```jsonc
// identity options            // the trigger
{ "roles": { "member": ["pro"] } }   →   "requireAuth": { "scopes": ["pro"] }
```

Projection happens **only on actual transitions** — `setRoles` revokes the
user's sessions (it's a privilege change), so a renewal webhook must never log
your customers out. Mid-graph, `billing.entitled` gives you `{ entitled,
status, purchased }` and `billing.owns` gives you `{ owns }` for one price —
both from the local mapping, no provider round-trip, safe on every request.

## Usage metering

`billing.usage.record` reports `value` units on a provider **meter** against
the user's customer; invoices aggregate automatically at period end. Pass a
stable `identifier` and provider-side dedup makes retries safe. Combined with
mod-ai's `ai.usage` events, metering agent tokens is an edge, not code:
construct the mod with `meterAiUsage: true` and it seeds the
**`billing.meter.ai-usage`** workflow — `ai.usage` → gate (signed-in user,
tokens reported) → `billing.usage.record` on the `aiMeter` meter. It's an
ordinary, non-internal workflow: open it in the editor to sample, split
per-model meters, or bucket guests.

## Options

```ts
billingMod({
  entitlement: { role: "member", gracePastDue: false },  // any paid subscription → role; false to disable
  grants: { lifetime: "member", team: "team" },          // price key → role: bought = for good, subscribed = while paid
  successPath: "/billing/success",
  cancelPath: "/billing/cancel",
  statusPath: "/billing/status",  // the success page's entitlement poller
  pages: true,                    // false = serve the return paths yourself
  portalReturnPath: "/",
  meterAiUsage: false,   // flip on to record ai.usage events to `aiMeter`
  aiMeter: "ai_tokens",
})
```

## Building a driver

Implement `BillingDriverSpec` (checkout/portal/subscription/usage/
`verifyAndParse`) and register it in your mod's `ready()`:

```ts
engine.service<BillingService>(BILLING_SERVICE)?.registerDriver(myDriver);
```

`verifyAndParse` receives the RAW webhook bytes; throw `BillingSignatureError`
on a bad signature (→ 401), return `null` for event types the contract doesn't
model (→ acknowledged), or a normalized `BillingEvent`. For a payment-mode
checkout, report `mode`, `priceKeys`, `amount`, `currency` and `sessionId` on
the `checkout.completed` event — mod-billing records the purchase and emits
`purchase.completed` itself (drivers never return that kind) — and make sure a
one-time buyer becomes a provider **customer**, since purchases hang off the
customer ↔ user mapping. The secret/option field lists you declare drive the
admin account form automatically.
