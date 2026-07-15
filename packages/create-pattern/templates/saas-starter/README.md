# {{name}}

A subscription SaaS scaffolded by [Pattern](https://pattern-js.dev): sign-in,
Stripe billing, and a members area gated by an auth scope — the paid role
arrives over a signed webhook and disappears when the subscription does.

```bash
npm install
npm run dev     # first boot prints a one-time admin link — you're the owner
```

- `/` — the landing page (Subscribe / Manage subscription)
- `/pro` — members only: `requireAuth: { scopes: ["pro"] }`
- `/admin` — the visual editor, runs, billing accounts, users

## Connect Stripe (test mode, ~5 minutes)

1. Create a product + recurring price; put `sk_test_…` in `.env` as
   `STRIPE_API_KEY`.
2. Admin → System → Billing → account `default` (provider `stripe`, secrets as
   env refs, `defaultPriceKey` = your `price_…`).
3. `stripe listen --forward-to localhost:3000/billing/webhook/stripe` — the
   printed `whsec_…` goes in `.env` as `STRIPE_WEBHOOK_SECRET`.
4. Subscribe with the test card `4242 4242 4242 4242` — `/pro` unlocks.

The full walkthrough (and how the entitlement bridge works) is in
[AGENTS.md](AGENTS.md); the deploy story (Dockerfile, volumes, env) is served
at `/docs` → “Deploying”.

## How it works

Checkout and the customer portal are **workflows** (`workflows/*.json`) — open
them in the admin editor. The webhook route is seeded by the Stripe driver;
its signature check is the gate. An entitled subscription grants the identity
role `member`, and identity's roles→scopes map turns that into the `pro`
scope — so the paid feature is one `requireAuth` away, with no billing code.

Money-touching workflows ship `"durable": true`: failed runs **resume from
the failing node** in admin → Runs, never repeating a call that already
happened.
