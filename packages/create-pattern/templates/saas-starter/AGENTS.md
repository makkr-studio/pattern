# Agent guide: {{name}} (Pattern · saas-starter modpack)

You are working in a **Pattern** project: a workflow engine where logic lives in
**workflows** (JSON graphs of typed ops) and code lives in **ops** (plain
functions contributed by mods). This scaffold is a **subscription SaaS**: sign-in
(mod-identity), billing (mod-billing + the Stripe driver), and a gated members
area — all of it workflows you can open in the admin editor at `/admin`.

## Ground rules

1. **Never guess op names or ports.** Ground truth is one command away:
   - `npx pattern ops`: every available op (core + this project's mods)
   - `npx pattern ops billing`: the billing surface (checkout, portal, entitled…)
   - `npx pattern ops billing.checkout.create`: full ports + config detail
2. **Validate every workflow JSON you touch:** `npx pattern validate <file>`,
   and `npx pattern graph <file>` to see it in the terminal.
3. `npm run dev` hot-reloads on file changes (workflows and mods included).
4. Don't edit `./.pattern` by hand (the admin's versioned store — commit it,
   don't rewrite it). Never commit `./.pattern-data` (real values: users,
   sessions, billing config, the RunLedger).

## How the money flows (the one diagram that matters)

```
Subscribe (landing) ─→ POST /billing/checkout ─→ billing.checkout.create ─→ Stripe-hosted page
                                                                                 │ pays
Stripe ─signed webhook─→ POST /billing/webhook/stripe (seeded by the driver) ─→ verify
     ─→ dedup (event id) ─→ customer mapping ─→ entitlement bridge: role "member" granted
                                                                                 │
identity roles→scopes (mods/identity.mjs): member → ["pro"] ─→ requireAuth { scopes: ["pro"] } opens /pro
```

Cancel in the customer portal → the deletion webhook removes the role → `/pro`
locks again. **No billing checks in app code** — entitlement is an auth scope.

- `mods/billing.mjs` — the bridge config (`entitlement: { role: "member" }`).
- `mods/identity.mjs` — the roles→scopes map (`member → ["pro"]`). Edit either
  and the next request reflects it; no session surgery.
- The webhook route is seeded by mod-billing-stripe (`billing.stripe.inbound`),
  `requireAuth: false` on purpose: the **signature is the gate**.

## First subscription in 5 minutes

1. In [Stripe test mode](https://dashboard.stripe.com/test/apikeys): create a
   product with a recurring price, copy the **price id** (`price_…`) and your
   **secret key** (`sk_test_…`) into `.env` as `STRIPE_API_KEY`.
2. `npm run dev`, open the one-time admin link from the console, then
   admin → **System → Billing** → create the account `default`: provider
   `stripe`, apiKey `{ source: "env", key: "STRIPE_API_KEY" }`, webhookSecret
   `{ source: "env", key: "STRIPE_WEBHOOK_SECRET" }`, and set
   `defaultPriceKey` to your `price_…`.
3. Tunnel the webhook:
   `stripe listen --forward-to localhost:3000/billing/webhook/stripe`
   — copy the printed `whsec_…` into `.env` as `STRIPE_WEBHOOK_SECRET`, restart.
4. On the landing page: sign in (magic link prints to the console), hit
   **Subscribe**, pay with the test card `4242 4242 4242 4242` (any future
   date, any CVC).
5. Watch the webhook run land in admin → **Runs**; your user now has the
   `member` role (admin → **Access → Users**) — `/pro` is open. Cancel in
   **Manage subscription** and it locks again.

## The workflows this scaffold ships

| File | Route | What it shows |
|---|---|---|
| `workflows/landing.json` | `GET /` | a public HTML page from a workflow |
| `workflows/checkout.json` | `POST /billing/checkout` | user → checkout session; **durable + retry** |
| `workflows/portal.json` | `POST /billing/portal` | the provider's subscription UI |
| `workflows/pro.json` | `GET /pro` | `requireAuth: { scopes: ["pro"] }` — the paid feature |

The checkout and portal workflows carry `"durable": true`: their runs record
exact inputs/outputs in the **RunLedger**, so a failed run can **Resume from
failure** in admin → Runs (completed nodes replay from the ledger — an
external call that already happened is never repeated). They also carry a
per-node `retry` on the provider call. That's the 0.5 durability toolkit —
use both on anything that touches money.

## Recipes

**Add a paid API endpoint** — copy `pro.json`, change `path`, wire your ops
between the trigger and the response. The gate is the `requireAuth` scopes.

**Different tiers** — add a second price in Stripe, then branch in the webhook
consumer or map more roles: `entitlement` grants one role; richer projections
can subscribe to the `billing.subscription.updated` bus event with a
`billing.event` trigger node and call `identity.users.setRoles` themselves.

**Usage-based billing** — uncomment `meterAiUsage` in `mods/billing.mjs` (needs
mod-ai): every model call's tokens flow to a Stripe meter via an editable
workflow. Attach a metered price to the meter and invoices bill themselves.

**Failure alerts** — set `PATTERN_ALERTS_TO` in `.env` and create the `default`
email account (admin → System → Email): any failed run emails you a deep link.

## Deploy

The scaffold ships a `Dockerfile` (two volumes: `.pattern/` the workflow store,
`.pattern-data/` the databases). The handbook chapter at `/docs` → “Deploying”
walks Fly.io / Railway / Render, env (`PATTERN_PUBLIC_URL` is REQUIRED behind
a proxy — webhooks and emailed links build on it), and points Stripe's
production webhook at `https://your-app/billing/webhook/stripe`.

## Workflow JSON, 60 seconds

- A **node** is an op instance (`id`, `op`, `config`); **edges** wire output
  ports to input ports; kinds must match (value/stream/control).
- Triggers start runs (`boundary.http.request`), out-gates answer
  (`boundary.http.response`). `requireAuth` lives on the trigger.
- Per-node `retry: { attempts, backoffMs }` re-runs a failing op with backoff;
  workflow-level `"durable": true` records runs for resume/re-run.
- The trigger's `user` port carries the signed-in identity (`{ id, email,
  scopes… }` or null) — decompose it with `core.object.extract`.
