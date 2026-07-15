# Billing

`@pattern-js/mod-billing` makes your app **take money**: hosted checkout and
the customer portal as ordinary ops, a normalized webhook event stream you can
build workflows on, and a subscription → role bridge that turns "paid feature"
into a plain `requireAuth` scope. It is the CONTRACT mod — provider mods plug
in underneath (`@pattern-js/mod-billing-stripe` first; the union is
provider-neutral so a `mod-billing-revolut` slots in without touching your
workflows).

```jsonc
{ "mods": ["@pattern-js/mod-billing", "@pattern-js/mod-billing-stripe"] }
```

## Accounts: names, never secrets

Like email, billing speaks in **accounts** — memorable names bound to a driver
plus *sourced* secrets (`{"source":"env","key":"STRIPE_API_KEY"}` or a vault
ref — never a value). Configure them in **admin → System → Billing**; ops fall
back to the `"default"` account. Re-pointing an account re-targets every
workflow that uses it.

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

## The webhook: verify → dedup → map → project → emit

The driver mod seeds a signed webhook route. Every delivery is:

1. **verified** against the account's signing secret (raw bytes, constant-time),
2. **deduped** on the provider's stable event id — providers redeliver on
   timeouts, and a double-processed `checkout.completed` is a support ticket
   with money in it (needs `@pattern-js/mod-store`),
3. **folded into the customer mapping** (`billing.customers`): user ↔
   provider-customer, status, prices, entitlement — browsable in the admin,
4. **projected into a role** (below), and
5. **emitted** as a normalized `billing.*` event.

The `billing.event` trigger subscribes to those events, so *"on payment
failed → email the user"* is an ordinary three-node workflow — filter with
`config.kind` or take all five kinds.

## Entitlement: a subscription becomes a role

With `@pattern-js/mod-identity` installed, an entitled subscription
(`active`/`trialing`, plus `past_due` under `gracePastDue`) grants the
configured role (default `member`); losing it removes the role. Identity
compiles roles → scopes per request, so gating a route behind a paid plan is:

```jsonc
// identity options            // the trigger
{ "roles": { "member": ["pro"] } }   →   "requireAuth": { "scopes": ["pro"] }
```

Projection happens **only on actual transitions** — `setRoles` revokes the
user's sessions (it's a privilege change), so a renewal webhook must never log
your customers out. Mid-graph, `billing.entitled` gives you `{ entitled }`
from the local mapping — no provider round-trip, safe on every request.

## Usage metering

`billing.usage.record` reports `value` units on a provider **meter** against
the user's customer; invoices aggregate automatically at period end. Pass a
stable `identifier` and provider-side dedup makes retries safe. Combined with
mod-ai's `ai.usage` events, metering agent tokens is an edge, not code.

## Options

```ts
billingMod({
  entitlement: { role: "member", gracePastDue: false },  // or false to disable
  successPath: "/billing/success",
  cancelPath: "/billing/cancel",
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
model (→ acknowledged), or a normalized `BillingEvent`. The secret/option
field lists you declare drive the admin account form automatically.
