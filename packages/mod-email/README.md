# @pattern-js/mod-email

Transactional email for [Pattern](../../README.md) — the **contract mod**.
Accounts (a named sender: driver + From + sourced credentials) are configured
in the admin; driver mods do the wire work
([`mod-email-resend`](https://www.npmjs.com/package/@pattern-js/mod-email-resend),
[`mod-email-smtp`](https://www.npmjs.com/package/@pattern-js/mod-email-smtp));
workflows send with one `email.send` node. Install it next to
`mod-auth-magic-link` and sign-in links start emailing the moment a `default`
account exists — console fallback until then, so nothing breaks on day one.

**Links:** [pattern-js.dev](https://pattern-js.dev) · [npm](https://www.npmjs.com/package/@pattern-js/mod-email)

```bash
npm install @pattern-js/mod-email @pattern-js/mod-email-resend
```

## When to use / when not

Reach for it when your app sends email — sign-in links, notifications, agent
tools — and you want the sender to be swappable config, not code: accounts
live in admin → **System → Email**, credentials in the vault or env vars, and
re-pointing an account re-targets every workflow using it. Skip it if your app
never sends email; if you only need dev sign-in, the magic-link console
fallback already covers you with zero mods.

## What you get

- **`email.send`** — to/subject + a `markdown` body (rendered to inline-styled
  HTML + a text alternative; a lone link becomes a button), or explicit
  `html`/`text`. Attachments from media bytes, blob refs, or literal files.
- **`email.account`** — resolve a named account to a ref (like `ai.alias` for
  models); `required: false` turns it into a probe to branch on.
- **Admin → System → Email** — accounts CRUD with per-driver fields, secrets
  from the vault or env, and a Test button that sends a REAL email.
- **`email.deliver-token`** — a visible, forkable workflow subscribed to
  identity's `identity.deliverToken` hook: sign-in links email themselves once
  a `default` account exists.
- A tiny **driver SPI** — `registerDriver({ id, label, secrets, options, send })`
  in your mod's `ready()`; the admin form generates itself from the field specs.

## Config

Defaults work from the bare config entry:

```jsonc
{ "mods": ["@pattern-js/mod-email", "@pattern-js/mod-email-resend"] }
```

To move the accounts file, export a local wrapper mod:

```js
// mods/email.mjs
import { emailMod } from "@pattern-js/mod-email";
export default emailMod({ configPath: "./.pattern-data/email-config.json" });
```

Full documentation: the **Email** chapter at `/docs` (served by
`@pattern-js/mod-docs`), or [the source](docs/index.md).
