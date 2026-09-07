# Billing · Stripe

`@pattern-js/mod-billing-stripe` is the Stripe driver for
[mod-billing](../mod-billing): Checkout Sessions, the Customer Portal,
subscription state and **Billing Meter** events — over a zero-dependency
`fetch` client — plus webhook verification with Stripe's own signature
scheme, feeding the contract's normalized event pipeline.

```jsonc
{ "mods": ["@pattern-js/mod-billing", "@pattern-js/mod-billing-stripe"] }
```

## Setup

1. In **admin → Administration → Billing**, add an account with provider `stripe`:
   the secret key and webhook secret as **refs** —
   `{"apiKey":{"source":"env","key":"STRIPE_API_KEY"},"webhookSecret":{"source":"env","key":"STRIPE_WEBHOOK_SECRET"}}` —
   and options like `{"defaultPriceKey":"pro"}` (a lookup key, or a `price_…` id).
2. Point a Stripe webhook endpoint at the seeded route
   **POST `/billing/webhook/stripe`**, sending at least:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed`.
3. Local dev: `stripe listen --forward-to localhost:3000/billing/webhook/stripe`
   prints its own `whsec_…` — use THAT as the webhook secret while developing,
   and `stripe trigger checkout.session.completed` to fire test events.

## What the driver does

- **Checkout** (`POST /v1/checkout/sessions`): subscription mode by default,
  `mode: "payment"` for a one-time sale (the session then asks Stripe to
  create a **customer**, so the purchase lands on the customer ↔ user mapping
  and the buyer can reach the portal for receipts). Your `userId` rides as
  `client_reference_id`, the price key and quantity as session `metadata` —
  the completed-session webhook carries no line items, so that is how a
  purchase reads back what was bought. Redirect URLs anchor on
  `PATTERN_PUBLIC_URL`. Server-side only — no publishable key anywhere.
- **Lookup keys**: a `priceKey` that isn't a `price_…` id is treated as the
  price's **lookup key** (set it in the dashboard: Product catalog → the price
  → lookup key) and resolved through `GET /v1/prices?lookup_keys[]=` once per
  key. Name prices `pro` / `lifetime` in test and live and the workflows never
  change. An unknown key fails with the no-effect verdict (nothing was created).
- **Portal** (`/v1/billing_portal/sessions`): a portal *configuration* must
  exist; the driver looks one up (or creates a minimal
  cancel/invoices/payment-methods one) on first use.
- **Webhooks**: HMAC-SHA256 **hex** over `t.rawBody` with the `whsec_…`
  value used *verbatim* (never base64-decoded — this is deliberately not the
  svix routine), multiple `v1` signatures honored during secret rotation,
  ±5 min tolerance, constant-time compare. The seeded route streams the RAW
  bytes (`bodyMode: "stream"`) because the signature covers them exactly.
- **Meters** (`POST /v1/billing/meter_events`): usage lands on a named meter;
  attach a metered price via `recurring[meter]` in the dashboard and invoices
  aggregate automatically. Legacy usage records are gone from current API
  versions — meters are the way.
- Every POST carries an `Idempotency-Key`, so a retried call can never create
  a second session or charge.

The API version is pinned in code (`2026-06-24.dahlia`) so upgrades are a
deliberate one-line change.
