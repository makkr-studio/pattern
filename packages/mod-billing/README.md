# @pattern-js/mod-billing

Payments for [Pattern](https://github.com/makkr-studio/pattern): the
provider-neutral billing contract. Hosted checkout and the customer portal as
single ops, a signed-webhook pipeline that verifies, **dedups on the
provider's stable event id**, maintains a user ↔ customer mapping, and
projects what was paid for into a mod-identity **role** — a subscription
while it stays paid, a one-time purchase for good — so a paid feature is just
`requireAuth: { scopes: ["pro"] }`. Plus usage metering for AI-shaped
pricing. Providers plug in as driver mods:
[`@pattern-js/mod-billing-stripe`](../mod-billing-stripe) first.

```jsonc
// pattern.config.json
{ "mods": ["@pattern-js/mod-billing", "@pattern-js/mod-billing-stripe"] }
```

Ops: `billing.checkout.create` (subscription or one-time), `billing.portal.create`,
`billing.subscription.get`, `billing.entitled`, `billing.owns`,
`billing.usage.record`, `billing.account`, the return pages
(`billing.success.page`, `billing.cancel.page`, `billing.status.mine`), and
the `billing.event` trigger (build workflows on "payment failed" or "purchase
completed").

Full chapter: your app's `/docs` → **Billing** (or
[the handbook source](./docs/index.md)).
