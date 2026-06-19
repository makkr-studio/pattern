# Magic-link login

`@pattern/mod-auth-magic-link` is the **reference login method** for
`@pattern/mod-identity`: a provider plugged into the identity kernel. It's
deliberately small enough to read in one sitting — it proves the login-method
SPI. Identity owns the kernel (single-use tokens, the `/auth/token` callback,
the signup policy, the login page); this mod owns just the *flow* of requesting
a link.

```jsonc
{ "mods": ["@pattern/mod-identity", "@pattern/mod-auth-magic-link"] }
```

## When to use it

Reach for it whenever you want passwordless email sign-in and don't want to
build a provider yourself — or as the worked example to copy when writing your
own (OIDC, SMS…). It registers its login method in `ready` (after the identity
service exists), so its order in `pattern.config.json` doesn't matter.

## The request → verify flow

- **Request** — `POST /auth/magic-link/request` with `{ email, next? }` (a
  browser form post *or* JSON) runs `auth.magiclink.request`: it issues a
  single-use `login` token and hands it to delivery. Issuance is **gated** — a
  token is minted only for a known, enabled user, or for an unknown email when
  signup is `open`; everything else does no work and sends nothing (delivery
  costs money, and an open issuer is a spam relay). The response is
  byte-identical either way, so nothing leaks about who exists — no account
  enumeration.
- **Verify** — the recipient opens the link, which is identity's own
  `GET /auth/token?t=…`: it consumes the token, finds-or-creates the user per
  the signup policy, mints a session, and redirects with the cookie set
  (riding `next` straight back to where they started).

## Delivery (and the zero-config dev login)

The request op delivers via identity's `identity.deliverToken` hook
(`{ email, url, purpose, delivered }`). Subscribe a workflow to that hook to
send the link by email/SMS/chat and return `delivered: true`. With no
subscriber, the link **prints to the server console** — which is precisely the
zero-config dev login: nothing to wire, same code path as production.

## Minimal config

Defaults work from the bare config entry. To customize the login-page label or
match a non-default identity `mount`, export a local wrapper mod:

```js
// mods/magic-link.mjs
import { magicLinkMod } from "@pattern/mod-auth-magic-link";
export default magicLinkMod({
  mount: "/auth",                       // must match the identity mod's mount
  label: "Send me a sign-in link",      // shown on the login page
});
```

## Integration: identity + magic-link + chat

The common stack is identity + magic-link + `@pattern/mod-chat`. Chat's
sign-in card posts the email straight to `/auth/magic-link/request` and rides
`next` back after login. Gate the chat surface with **`CHAT_REQUIRE_AUTH`** —
chat routes default to `requireAuth: { env: "CHAT_REQUIRE_AUTH" }`, read per
request: unset/false lets guests in, `true`/`1` requires any signed-in user,
anything else is a comma-separated scope list. The chat SPA route itself stays
open and renders its own sign-in. Installing identity alongside
`@pattern/mod-admin` separately flips the **admin** to require the `admin`
scope (the admin auth seam) — unless `adminMod({ auth: false })`.
