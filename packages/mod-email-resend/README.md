# @pattern-js/mod-email-resend

The [Resend](https://resend.com) driver for
[`@pattern-js/mod-email`](https://www.npmjs.com/package/@pattern-js/mod-email)
on [Pattern](../../README.md) — dependency-free (Resend's send API is one
fetch). Install both, create an account in admin → System → Email, and
`email.send` (plus sign-in links) delivers through Resend.

**Links:** [pattern-js.dev](https://pattern-js.dev) · [npm](https://www.npmjs.com/package/@pattern-js/mod-email-resend)

```bash
npm install @pattern-js/mod-email @pattern-js/mod-email-resend
```

## When to use / when not

The easy path to production email: an API key and a verified domain, no SMTP
credentials or relay to run. Prefer
[`mod-email-smtp`](https://www.npmjs.com/package/@pattern-js/mod-email-smtp)
when you already have a relay/provider you must use, or want a local catcher
(Mailpit) in dev.

## Config

Nothing to configure in code — list it and manage accounts in the admin:

```jsonc
{ "mods": ["@pattern-js/mod-email", "@pattern-js/mod-email-resend"] }
```

Account fields: the `apiKey` secret (vault or env, e.g. `RESEND_API_KEY`) and
an optional `baseUrl` (proxy / regional endpoint / test seam).

Full documentation: the **Email · Resend** chapter at `/docs`, or
[the source](docs/index.md).
