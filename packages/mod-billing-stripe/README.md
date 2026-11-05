# @pattern-js/mod-billing-stripe

Stripe driver for
[`@pattern-js/mod-billing`](../mod-billing): Checkout Sessions, the Customer
Portal, subscription state and **Billing Meter** events over a
zero-dependency `fetch` client — plus `Stripe-Signature` webhook verification
(raw bytes, hex HMAC, secret used verbatim, rotation-aware, constant-time)
feeding the contract's verified → deduped → mapped → role-projected event
pipeline. Every POST carries an `Idempotency-Key`, so retries can never
double-charge.

```jsonc
// pattern.config.json
{ "mods": ["@pattern-js/mod-billing", "@pattern-js/mod-billing-stripe"] }
```

Local dev: `stripe listen --forward-to localhost:3000/billing/webhook/stripe`.

Full chapter: your app's `/docs` → **Billing · Stripe** (or
[the handbook source](./docs/index.md)).
