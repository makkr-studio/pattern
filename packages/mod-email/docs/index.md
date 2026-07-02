# Email

`@pattern-js/mod-email` is the **email contract**: it owns the accounts, the
`email.send` / `email.account` ops, the admin page, and a packaged workflow
that delivers identity sign-in links. It sends nothing by itself — a **driver
mod** does the wire work: `@pattern-js/mod-email-resend` (the Resend API) or
`@pattern-js/mod-email-smtp` (any SMTP relay, via nodemailer). Several drivers
can live in one runtime side by side.

```jsonc
{ "mods": ["@pattern-js/mod-email", "@pattern-js/mod-email-resend"] }
```

## Accounts

The one persisted concept is the **account** — a memorable name bound to a
driver, a From address, sourced secrets and driver options. Two accounts of
the same driver with different credentials are just two records (prod + a
staging relay, a marketing sender + an alerts sender). Manage them in admin →
**System → Email**; the form generates itself from whatever fields the
registered drivers declare, and the **Test** button sends a real email so you
verify end-to-end delivery, not a wiring check.

The `"default"` account is the convention everything falls back to: an
`email.send` node with nothing wired uses it, and the sign-in delivery
workflow probes for it.

Credentials never sit in workflow values or in the accounts file — an account
stores *references* (`{ source: "vault" | "env", key }`), resolved at send
time. The value flowing on edges is an `EmailAccountRef` (the account NAME),
so re-pointing an account in admin instantly re-targets every workflow using
it — the same move as mod-ai's model aliases.

## Sending from a workflow

`email.send` takes `to` + `subject` + a body. Write the body once in
**`markdown`** — it renders to inline-styled HTML plus a plain-text
alternative, and a paragraph that is exactly one link becomes a button — or
pass explicit `html`/`text`, which win per part. Attachments accept in-memory
media (`{ bytes, mime }`, what `ai.image.generate` outputs), blob references
(`{ blobId }`, what `store.blob.put` returns), or literal files
(`{ filename, content }`). Pick a non-default sender by wiring an
`email.account` node into its `account` input.

## Sign-in links, delivered

mod-identity delivers login/invite links through its `identity.deliverToken`
hook, with a console fallback. This mod ships a visible workflow —
**`email.deliver-token`** — subscribed to that hook: while no `default`
account exists it passes the payload through untouched (links keep printing to
the console, nothing to configure), and the moment you create the account,
sign-in links go by email. A broken account never locks you out: the send
fails, identity logs a warning, and the console fallback prints the link
anyway. Open the workflow in the admin editor to reword the email (two
`core.string.template` nodes) or fork it entirely — see the
[delivery guide](guides/delivery.md).

## Writing a driver

A driver mod registers an `EmailDriverSpec` on the email service in `ready()`:

```ts
import { EMAIL_SERVICE, type EmailService } from "@pattern-js/mod-email";

export default defineMod({
  name: "my-email-driver",
  ready: (engine) => {
    engine.service<EmailService>(EMAIL_SERVICE)?.registerDriver({
      id: "acme",
      label: "Acme Mail",
      secrets: [{ field: "apiKey", label: "API key", required: true }],
      options: [{ field: "region", label: "Region", placeholder: "us-east-1" }],
      send: async (message, creds, options) => {
        // message is fully normalized: from/to[]/subject/html/text/attachments (bytes)
        return { messageId: "..." };
      },
    });
  },
});
```

The declared `secrets`/`options` fields drive the account form in admin — a
driver mod ships zero UI. `mod-email-resend` is the worked example to copy
(one fetch, ~60 lines).

## Config

Defaults work from the bare config entry. The accounts file lives at
`.pattern-data/email-config.json`; to move it, export a local wrapper mod:

```js
// mods/email.mjs
import { emailMod } from "@pattern-js/mod-email";
export default emailMod({ configPath: "./.pattern-data/email-config.json" });
```
