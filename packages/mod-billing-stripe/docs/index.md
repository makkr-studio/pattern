# Billing · Stripe

`@pattern-js/mod-billing-stripe` is the Stripe driver for
`@pattern-js/mod-billing` (the **Billing** chapter): Checkout Sessions, the Customer Portal,
subscription state and **Billing Meter** events — over a zero-dependency
`fetch` client — plus webhook verification with Stripe's own signature
scheme, feeding the contract's normalized event pipeline.

```jsonc
{ "mods": ["@pattern-js/mod-billing", "@pattern-js/mod-billing-stripe"] }
```

## Setup

1. Store the keys in the vault: admin → **Resources → Secrets**, as
   `STRIPE_API_KEY` (your `sk_test_…` from dashboard → Developers → API keys)
   and, once step 3 prints it, `STRIPE_WEBHOOK_SECRET`. Vault secrets resolve
   per call, so no restart is needed.
2. In **admin → Administration → Billing**, add an account named `default`
   with provider `stripe`, its secrets as **refs** to those names:
   `{"apiKey":{"source":"vault","key":"STRIPE_API_KEY"},"webhookSecret":{"source":"vault","key":"STRIPE_WEBHOOK_SECRET"}}`
   (use `"source":"env"` to read environment variables instead, for example
   in a container), and options like `{"defaultPriceKey":"pro"}` (a lookup
   key, or a `price_…` id). The same writes are open to scripts and agents:
   `billing.accounts.write` and `vault.admin.write` back the admin's
   `/admin/api/...` routes (their op pages show the shapes).
3. Local dev: `stripe listen --forward-to localhost:<PORT>/billing/webhook/stripe`
   prints its own `whsec_…`: use THAT as the webhook secret while developing.
4. Production: point a Stripe webhook endpoint at the seeded route
   **POST `/billing/webhook/stripe`**, sending at least:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed`.

**Testing the bridge.** The honest test is a real test-mode checkout: run
`stripe listen`, sign in, subscribe, and pay with `4242 4242 4242 4242`.
`stripe trigger checkout.session.completed` fires an event, but it belongs to
no user of yours (it has no `client_reference_id`), so it can't grant
anything. The fields the driver reads are: on the completed session,
`client_reference_id` (your user id), `customer`, `subscription`, `mode`, and
`metadata.priceKey`; on subscription events, `customer`, `status`, and
`items.data[].price.lookup_key` (else `.id`). A hand-signed event with those
fields works too: the signature is HMAC-SHA256 hex over `t.rawBody` with the
`whsec_…` value.

Verifying a webhook needs only the webhook secret; the API key is not read
for incoming events.

## What the driver does

- **Checkout** (`POST /v1/checkout/sessions`): subscription mode by default,
  `mode: "payment"` for a one-time sale (the session then asks Stripe to
  create a **customer**, so the purchase lands on the customer ↔ user mapping;
  receipts are Stripe's emailed receipts, on in Settings → Customer emails). Your `userId` rides as
  `client_reference_id`, the price key and quantity as session `metadata` —
  the completed-session webhook carries no line items, so that is how a
  purchase reads back what was bought. Redirect URLs anchor on
  `PATTERN_PUBLIC_URL`. Server-side only — no publishable key anywhere.
- **Lookup keys**: a `priceKey` that isn't a `price_…` id is treated as the
  price's **lookup key** (set it in the dashboard: Product catalog → the price
  → lookup key) and resolved through `GET /v1/prices?lookup_keys[]=` once per
  key. Name prices `pro` / `lifetime` in test and live and the workflows never
  change. Lookup keys are unique per Stripe account: if `pro` is taken (a
  shared test account), pick another and change the workflow's `priceKey`. An unknown key fails with the no-effect verdict (nothing was created).
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
