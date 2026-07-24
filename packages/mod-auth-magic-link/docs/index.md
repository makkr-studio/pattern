# Magic-link login

`@pattern-js/mod-auth-magic-link` is the **reference login method** for
`@pattern-js/mod-identity`: a provider plugged into the identity kernel. It's
deliberately small enough to read in one sitting. It proves the login-method
SPI. Identity owns the kernel (single-use tokens, the `/auth/token` and
`/auth/code` callbacks, the signup policy, the login page); this mod owns the
*flow* of requesting a sign-in.

```jsonc
{ "mods": ["@pattern-js/mod-identity", "@pattern-js/mod-auth-magic-link"] }
```

## When to use it

Reach for it whenever you want passwordless email sign-in and don't want to
build a provider yourself, or as the worked example to copy when writing your
own (OIDC, SMS…). It registers its login method in `ready` (after the identity
service exists), so its order in `pattern.config.json` doesn't matter.

## The request → verify flow

- **Request**: `POST /auth/magic-link/request` with `{ email, next? }` (a
  browser form post *or* JSON) runs `auth.magiclink.request`: it issues a
  single-use `login` token — carrying both a **link** and a **6-digit code** —
  and hands it to delivery. Issuance is **gated**: a token is minted only for
  a known, enabled user, or for an unknown email when signup is `open`;
  everything else does no work and sends nothing (delivery costs money, and an
  open issuer is a spam relay). The response is byte-identical either way, so
  nothing leaks about who exists (no account enumeration).
- **Verify, the link way**: the recipient opens the link, which is identity's
  own `GET /auth/token?t=…`: it consumes the token, finds-or-creates the user
  per the signup policy, mints a session, and redirects with the cookie set
  (riding `next` straight back to where they started).
- **Verify, the code way (installed PWAs)**: for a standalone-display app the
  link is a trap — the mail client opens it in the *system browser*, whose
  cookie jar the installed app never sees. So the "check your inbox" page also
  carries a code form posting to identity's `POST /auth/code`: the emailed
  code, typed where the user already is, sets the cookie **in that browsing
  context**. Link and code share the one token — whichever is used first burns
  both; five wrong guesses burn it too, and failures render identically for
  unknown emails and wrong codes.

## Delivery (and the zero-config dev login)

The request op delivers via identity's `identity.deliverToken` hook
(`{ email, url, purpose, delivered, subject, message, code }`). Subscribe a
workflow to that hook to send the sign-in by email/SMS/chat and return
`delivered: true`; the default `message` copy already includes the code
("…or enter the code 482 913…"), and custom templates can render `code`
however they like. With no subscriber, the link **and code print to the
server console**, the zero-config dev login: nothing to wire, same code path
as production.

## Minimal config

Defaults work from the bare config entry. To customize the login-page label or
match a non-default identity `mount`, export a local wrapper mod:

```js
// mods/magic-link.mjs
import { magicLinkMod } from "@pattern-js/mod-auth-magic-link";
export default magicLinkMod({
  mount: "/auth",                       // must match the identity mod's mount
  label: "Send me a sign-in link",      // shown on the login page
});
```

## Integration: identity + magic-link + chat

The common stack is identity + magic-link + `@pattern-js/mod-chat`. Chat's
sign-in card posts the email straight to `/auth/magic-link/request` and rides
`next` back after login. Gate the chat surface with **`CHAT_REQUIRE_AUTH`**:
chat routes default to `requireAuth: { env: "CHAT_REQUIRE_AUTH" }`, read per
request: unset/false lets guests in, `true`/`1` requires any signed-in user,
anything else is a comma-separated scope list. The chat SPA route itself stays
open and renders its own sign-in. Installing identity alongside
`@pattern-js/mod-admin` separately flips the **admin** to require the `admin`
scope (the admin auth seam), unless `adminMod({ auth: false })`.
