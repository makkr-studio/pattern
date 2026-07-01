# Email · SMTP

`@pattern-js/mod-email-smtp` is the SMTP driver for `@pattern-js/mod-email`,
built on [nodemailer](https://nodemailer.com) — any relay (SES, Postmark,
Mailgun, your provider's SMTP endpoint), your own server, or a local catcher
like [Mailpit](https://mailpit.axllent.org) in dev.

```jsonc
{ "mods": ["@pattern-js/mod-email", "@pattern-js/mod-email-smtp"] }
```

## Fields

Configured per account in admin → **System → Email**:

- **Option `host`** (required) — the SMTP server.
- **Option `port`** — default `587`.
- **Option `secure`** — `"true"` for implicit TLS (usually port 465);
  leave unset/`"false"` for STARTTLS on 587, the common case.
- **Option `user`** — the username; leave empty for an unauthenticated relay.
- **Secret `pass`** — the password, by reference (vault name or env-var name
  such as `SMTP_PASSWORD`); only needed when `user` is set.

Press **Test** after saving — a real email proves host, TLS mode, credentials
and From acceptance in one go.

## Dev tip: a local catcher

Run Mailpit (`docker run -p 1025:1025 -p 8025:8025 axllent/mailpit`), create a
`default` account with `host: localhost`, `port: 1025`, no user — and every
sign-in link lands in the catcher's inbox at `http://localhost:8025`. Real
delivery mechanics, zero real emails.

## Under the hood

nodemailer handles the protocol (STARTTLS vs implicit TLS, AUTH mechanisms,
MIME); transports pool connections and are cached per account config, and the
cache self-invalidates when credentials rotate. SMTP errors surface as the
run's error verbatim (`454 TLS required`, `535 authentication failed`, …).
