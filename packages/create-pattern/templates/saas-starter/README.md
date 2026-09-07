# {{name}}

A paid product scaffolded by [Pattern](https://pattern-js.dev): sign-in, Stripe
payments — a **subscription** or a **one-time purchase** — and a members area
gated by an auth scope. The paid role arrives over a signed webhook; a
subscription's disappears when it ends, a purchase's never does.

```bash
npm install
npm run dev     # first boot prints a one-time admin link — you're the owner
```

- `/` — the landing page (Subscribe · Buy lifetime access · Manage subscription)
- `/pro` — members only: `requireAuth: { scopes: ["pro"] }` — either way in
- `/admin` — the visual editor, runs, billing (customers, purchases), users

## Connect Stripe (test mode, ~5 minutes)

1. Create a product with two prices — recurring, lookup key `pro`; one-time,
   lookup key `lifetime` — and paste `sk_test_…` into
   admin → Resources → **Secrets** as `STRIPE_API_KEY` (encrypted, no restart).
2. Admin → Administration → **Billing** → account `default` (provider `stripe`,
   secrets as vault refs, Default price `pro`).
3. `stripe listen --forward-to localhost:3000/billing/webhook/stripe` — the
   printed `whsec_…` goes into Secrets as `STRIPE_WEBHOOK_SECRET`.
4. Subscribe (or Buy) with the test card `4242 4242 4242 4242` — you land on
   the success page, it unlocks, and `/pro` opens.

The full walkthrough, the recipes (add a subscription paywall, add a one-time
purchase, do something on payment), and how the entitlement bridge works are
in [AGENTS.md](AGENTS.md); the deploy story (Dockerfile, volumes, env) is
served at `/docs` → “Deploying”.

## How it works

Checkout, buy, and the customer portal are **workflows** (`workflows/*.json`) —
open them in the admin. The webhook route is seeded by the Stripe driver; its
signature check is the gate. An entitled subscription grants the identity role
`member` (`entitlement` in `mods/billing.mjs`); a bought `lifetime` price
grants it for good (`grants`); identity's roles→scopes map turns that into the
`pro` scope — so the paid feature is one `requireAuth` away, with no billing
code. Prices are named by Stripe **lookup key**, so nothing here changes
between test and live.

Money-touching workflows ship `"durable": true`: failed runs **resume from
the failing node** from the run page, never repeating a call that already
happened.
