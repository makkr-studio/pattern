# @pattern-js/mod-billing

Payments for [Pattern](https://github.com/makkr-studio/pattern): the
provider-neutral billing contract. Hosted checkout and the customer portal as
single ops, a signed-webhook pipeline that verifies, **dedups on the
provider's stable event id**, maintains a user ↔ customer mapping, and
projects subscription state into a mod-identity **role** — so a paid feature
is just `requireAuth: { scopes: ["pro"] }`. Plus usage metering for
AI-shaped pricing. Providers plug in as driver mods:
[`@pattern-js/mod-billing-stripe`](../mod-billing-stripe) first.

```jsonc
// pattern.config.json
{ "mods": ["@pattern-js/mod-billing", "@pattern-js/mod-billing-stripe"] }
```

Ops: `billing.checkout.create`, `billing.portal.create`,
`billing.subscription.get`, `billing.entitled`, `billing.usage.record`,
`billing.account`, and the `billing.event` trigger (build workflows on
"payment failed").

Full chapter: your app's `/docs` → **Billing** (or
[the handbook source](./docs/index.md)).
