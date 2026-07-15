---
title: Deploying
order: 18
---

# Deploying

A Pattern app is a plain Node process: `node src/index.ts`, one port, state on
disk. Every scaffolded app ships a `Dockerfile`, so the distance from
`npm create pattern` to a URL is a container build and two volumes.

## The container contract

Two directories hold everything the process can't lose — they have different
jobs, so mount **both** as volumes:

| Directory | What it is | Git |
|---|---|---|
| `.pattern/` | the versioned workflow store (drafts, versions, audit) and trace history | commit it — it's your app |
| `.pattern-data/` | the databases: identity (users/sessions), documents & blobs, vectors, the RunLedger, AI/billing/email account config | **never** — real values, PII, encrypted secrets |

Treat `.pattern-data/` like your database, because it is one: durable runs
record exact values there, identity keeps sessions there, the vault keeps its
ciphertext there.

## Environment

| Variable | Why |
|---|---|
| `PORT` | the listen port (default 3000) |
| `PATTERN_PUBLIC_URL` | your public origin, e.g. `https://app.example.com`. Emailed links (sign-in, invites), OIDC redirects, and checkout redirects are built on it. Behind ANY proxy this must be set — the request's Host header lies. |
| `PATTERN_VAULT_KEY` | the vault's master key, if your app uses the vault (`.env.example` says) |
| `PATTERN_ALERTS_TO` | optional: an operator address — a failed run sends an email there (needs a `default` email account) |
| provider keys | whatever your `.env.example` lists: AI providers, `RESEND_API_KEY`, `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, … |

Secrets referenced as `{ "source": "env", "key": "..." }` in accounts and
aliases read from this environment; `{ "source": "vault", ... }` ones read from
the vault. Values never live in config files.

## Docker, locally

```bash
docker build -t my-app .
docker run -p 3000:3000 --env-file .env \
  -v pattern-store:/app/.pattern \
  -v pattern-data:/app/.pattern-data \
  my-app
```

The scaffolded `Dockerfile` is plain: `node:22-slim`, `npm ci --omit=dev`,
`CMD ["node", "src/index.ts"]`. Edit freely — it's yours.

## Fly.io

```bash
fly launch --no-deploy        # detects the Dockerfile, writes fly.toml
fly volumes create pattern_data
```

Add the mounts to `fly.toml` (one volume per mount section; put both state
dirs on it via a shared parent, or create two volumes):

```toml
[mounts]
  source = "pattern_data"
  destination = "/app/.pattern-data"
```

Then secrets and ship:

```bash
fly secrets set PATTERN_PUBLIC_URL=https://my-app.fly.dev STRIPE_API_KEY=sk_...
fly deploy
```

## Railway

Create a project from your repo — Railway builds the `Dockerfile` it finds.
In the service settings: add a **Volume** mounted at `/app/.pattern-data`
(and one at `/app/.pattern` if you author workflows in production), and set
the environment variables under **Variables**. Railway injects `PORT`; set
`PATTERN_PUBLIC_URL` to the generated domain.

## Render

New **Web Service** → your repo → runtime **Docker**. Add a **Persistent
Disk** mounted at `/app/.pattern-data`, set the env vars in the dashboard,
and point `PATTERN_PUBLIC_URL` at the `onrender.com` URL (or your custom
domain). Render injects `PORT`.

## Webhooks in development

Inbound webhooks (Stripe billing, Resend inbound email) need to reach your
laptop. The provider CLIs tunnel them:

```bash
stripe listen --forward-to localhost:3000/billing/webhook/stripe
# prints a whsec_… — that's your webhook secret while it runs
```

In production, point the provider's webhook endpoint at
`https://your-app/billing/webhook/stripe` (or `/email/inbound/resend`) and put
the real signing secret in the account's `webhookSecret` ref. The signature is
the gate — the routes are deliberately public.

## A production checklist

- `PATTERN_PUBLIC_URL` set (proxies lie about Host)
- both state dirs on durable volumes
- `cookieSecure: true` on identity once you're behind TLS
- an email account named `default` (sign-in links, alerts)
- `PATTERN_ALERTS_TO` so failed runs reach a human
- durable (`durable: true`) on the workflows that touch money — resume beats
  re-charge
