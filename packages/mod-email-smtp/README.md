# @pattern-js/mod-email-smtp

The SMTP driver for
[`@pattern-js/mod-email`](https://www.npmjs.com/package/@pattern-js/mod-email)
on [Pattern](../../README.md), built on nodemailer — any relay, your own
server, or a local catcher (Mailpit) in dev. Host/port/user are account
options in admin → System → Email; the password comes from the vault or an
env var.

**Links:** [pattern-js.dev](https://pattern-js.dev) · [npm](https://www.npmjs.com/package/@pattern-js/mod-email-smtp)

```bash
npm install @pattern-js/mod-email @pattern-js/mod-email-smtp
```

## When to use / when not

Reach for it when you already have SMTP credentials (SES, Postmark, Mailgun,
a corporate relay) or want a local catcher in dev. Prefer
[`mod-email-resend`](https://www.npmjs.com/package/@pattern-js/mod-email-resend)
for the least-setup path to production email (one API key, no relay).

## Config

Nothing to configure in code — list it and manage accounts in the admin:

```jsonc
{ "mods": ["@pattern-js/mod-email", "@pattern-js/mod-email-smtp"] }
```

Account fields: `host` (required), `port` (587), `secure`
(`"true"` = implicit TLS; default STARTTLS), `user`, and the `pass` secret
(vault or env, e.g. `SMTP_PASSWORD`). For tests, the mod factory accepts a
`transportFactory` seam: `smtpEmailMod({ transportFactory })`.

Full documentation: the **Email · SMTP** chapter at `/docs`, or
[the source](docs/index.md).
