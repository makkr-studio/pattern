# Agent guide: {{name}} (Pattern · saas-starter modpack)

You are working in a **Pattern** project: a workflow engine where logic lives in
**workflows** (JSON graphs of typed ops) and code lives in **ops** (plain
functions contributed by mods). This scaffold is a **paid product**: sign-in
(mod-identity), payments (mod-billing + the Stripe driver — **recurring
subscriptions and one-time purchases**), and a gated members area — all of it
workflows you can open in the admin at `/admin` → Workflows.

## Ground rules

1. **Never guess op names or ports.** Ground truth is one command away:
   - `npx pattern ops`: every available op (core + this project's mods)
   - `npx pattern ops billing`: the billing surface (checkout, portal, entitled, owns…)
   - `npx pattern ops billing.checkout.create`: full ports + config detail
2. **Validate every workflow JSON you touch:** `npx pattern validate <file>`,
   and `npx pattern graph <file>` to see it in the terminal.
3. `npm run dev` hot-reloads on file changes (workflows and mods included).
4. Don't edit `./.pattern` by hand (the admin's versioned store — commit it,
   don't rewrite it). Never commit `./.pattern-data` (real values: users,
   sessions, billing config, the RunLedger).
5. **Money is never checked in app code.** Whether someone paid is an auth
   scope on the route (`requireAuth`), granted by a signed webhook. Inside a
   graph, `billing.entitled` / `billing.owns` read the local mapping — never
   the provider.

## How the money flows (the one diagram that matters)

```
                 ┌─ Subscribe ─→ POST /billing/checkout ─→ billing.checkout.create (mode: subscription, priceKey: "pro")
landing page ────┤                                                                         │ Stripe-hosted page, pays
                 └─ Buy once ──→ POST /billing/buy ───────→ billing.checkout.create (mode: payment, priceKey: "lifetime")
                                                                                            │
Stripe ─signed webhook─→ POST /billing/webhook/stripe (seeded by the driver) ─→ verify ─→ dedup (event id)
   ─→ customer mapping ─→ roles: subscription entitled → "member" (while paid)     [mods/billing.mjs: entitlement]
                                 "lifetime" purchased  → "member" (for good)       [mods/billing.mjs: grants]
                                                                                            │
identity roles→scopes (mods/identity.mjs): member → ["pro"] ─→ requireAuth { scopes: ["pro"] } opens /pro
```

Cancel a subscription in the customer portal → the deletion webhook removes the
role → `/pro` locks again. A purchase never expires. **No billing checks in app
code** — entitlement is an auth scope.

- `mods/billing.mjs` — the bridge: `entitlement` (any paid subscription → a
  role) and `grants` (price key → role: bought = forever, subscribed = while
  paid). Add a tier: add a grant, map its role in identity.
- `mods/identity.mjs` — the roles→scopes map (`member → ["pro"]`). Edit either
  file and the next request reflects it; no session surgery.
- **Price keys are Stripe lookup keys** (`pro`, `lifetime`), set on each price
  in the Stripe dashboard (Product catalog → the price → *lookup key*). Config
  never names a `price_…` id, so test and live keys carry the same workflows.
- The webhook route is seeded by mod-billing-stripe (`billing.stripe.inbound`),
  `requireAuth: false` on purpose: the **signature is the gate**.

## First payment in 5 minutes

1. In [Stripe test mode](https://dashboard.stripe.com/test/products): create a
   product with **two prices** — a recurring one with lookup key `pro` and a
   one-time one with lookup key `lifetime` (the *lookup key* field is under
   the price's advanced options). Note your **secret key** (`sk_test_…`).
2. `npm run dev`, open the one-time admin link from the console. In
   admin → **Resources → Secrets**, add `STRIPE_API_KEY` = your `sk_test_…`
   (encrypted at rest; applies on the next call, no restart). Then
   admin → **Administration → Billing** → create the account `default`:
   provider `stripe`, apiKey `vault / STRIPE_API_KEY`, webhookSecret
   `vault / STRIPE_WEBHOOK_SECRET`, Default price `pro`. (Prefer `.env`?
   Uncomment the keys in `.env.example`, copy to `.env`, and pick `env` refs
   instead — that path needs a restart per change.)
3. Tunnel the webhook:
   `stripe listen --forward-to localhost:3000/billing/webhook/stripe`
   — paste the printed `whsec_…` into admin → **Resources → Secrets** as
   `STRIPE_WEBHOOK_SECRET`. No restart needed.
4. On the landing page: sign in (magic link prints to the console), hit
   **Subscribe** or **Buy lifetime access**, pay with the test card
   `4242 4242 4242 4242` (any future date, any CVC).
5. You land on `/billing/success` — a page mod-billing serves for you. It
   polls until the webhook grants the `member` role (a subscription) or
   records the purchase (one-time), then forwards to `/pro` (both checkout
   workflows set `next: "/pro"`). Watch the webhook run land in the workflow's
   **Runs** tab; see the customer and the purchase in admin →
   **Administration → Billing**. Cancel in **Manage subscription** and `/pro`
   locks again — unless they bought lifetime.

## The workflows this scaffold ships

| File | Route | What it shows |
|---|---|---|
| `workflows/landing.json` | `GET /` | a public HTML page from a workflow |
| `workflows/checkout.json` | `POST /billing/checkout` | **recurring**: user → subscription checkout; durable + retry |
| `workflows/buy.json` | `POST /billing/buy` | **one-time**: user → payment checkout for `lifetime`; durable + retry |
| `workflows/portal.json` | `POST /billing/portal` | the provider's subscription UI (cancel, cards, invoices) |
| `workflows/pro.json` | `GET /pro` | `requireAuth: { scopes: ["pro"] }` — the paid feature, either way |

Not files here, but part of the surface: mod-billing itself serves
`GET /billing/success` (polls until the unlock lands, then forwards to `next`),
`GET /billing/cancel`, and `GET /billing/status` (the calling user's
`{ signedIn, entitled, status, purchased }`). Move or disable them via the
mod's `successPath`/`cancelPath`/`pages` options if you want your own.

The checkout, buy and portal workflows carry `"durable": true`: their runs
record exact inputs/outputs in the **RunLedger**, so a failed run can **Resume**
from the run page (completed nodes replay from the ledger — an external call
that already happened is never repeated). They also carry a per-node `retry` on
the provider call. That's the 0.5 durability toolkit — use both on anything
that touches money.

## Recipes

**Add a subscription paywall** — three knobs: a recurring price with a lookup
key (`team`), a checkout workflow (copy `checkout.json`, set `priceKey`), and a
gate. The gate is a role: either reuse `member` (any subscription) or give the
plan its own — `grants: { team: "team" }` in `mods/billing.mjs`, then
`team: ["team", "pro"]` in `mods/identity.mjs` — and put
`"requireAuth": { "scopes": ["team"] }` on the routes it unlocks.

**Add a one-time purchase** — a one-time price with a lookup key (`credits`),
a checkout workflow with `"mode": "payment"` (copy `buy.json`, set `priceKey`
and `next`), and either a grant (`grants: { credits: "member" }` — the buyer
keeps the role) or a mid-graph check: `billing.owns` (config `priceKey`, wire
the trigger's `user.id` into `userId`) → `core.flow.branch` on `owns`.

**Do something when someone pays** — a workflow starting with the
`billing.event` trigger, `config.kind` = `purchase.completed` (one-time) or
`subscription.updated` / `invoice.payment_failed` (recurring). Its outputs
carry `{ event, kind, account, userId }` — wire `email.send`, provision a
resource, post to Slack. It runs after the role is projected, so the buyer is
already unlocked.

**Add a paid API endpoint** — copy `pro.json`, change `path`, wire your ops
between the trigger and the response. The gate is the `requireAuth` scopes —
nothing about billing appears in the workflow.

**Sell several things** — every checkout workflow names its own `priceKey`;
every price gets a `grants` entry (or none, if `billing.owns` mid-graph is the
gate). The Billing page's Customers table shows each user's plan and what they
own; Purchases lists every one-time sale.

**Usage-based billing** — uncomment `meterAiUsage` in `mods/billing.mjs` (needs
mod-ai): every model call's tokens flow to a Stripe meter via an editable
workflow. Attach a metered price to the meter and invoices bill themselves.

**Failure alerts** — set `PATTERN_ALERTS_TO` in `.env` and create the `default`
email account (admin → Resources → Email): any failed run emails you a deep link.

## Deploy

The scaffold ships a `Dockerfile` (two volumes: `.pattern/` the workflow store,
`.pattern-data/` the databases). The handbook chapter at `/docs` → “Deploying”
walks Fly.io / Railway / Render, env (`PATTERN_PUBLIC_URL` is REQUIRED behind
a proxy — webhooks and emailed links build on it), and points Stripe's
production webhook at `https://your-app/billing/webhook/stripe`. Lookup keys
are per Stripe account: create the same `pro` / `lifetime` keys on your live
prices and nothing in the repo changes.

## Workflow JSON, 60 seconds

- A **node** is an op instance (`id`, `op`, `config`); **edges** wire output
  ports to input ports; kinds must match (value/stream/control).
- Triggers start runs (`boundary.http.request`), out-gates answer
  (`boundary.http.response`). `requireAuth` lives on the trigger.
- Per-node `retry: { attempts, backoffMs }` re-runs a failing op with backoff;
  workflow-level `"durable": true` records runs for resume/re-run.
- The trigger's `user` port carries the signed-in identity (`{ id, email,
  scopes… }` or null) — decompose it with `core.object.extract`.
