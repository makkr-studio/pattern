# @pattern/mod-auth-magic-link

Passwordless email sign-in for [Pattern](../../README.md) — the **reference login
method** for `@pattern/mod-identity`, a provider plugged into the identity
kernel. Identity owns the kernel (single-use tokens, the `/auth/token` callback,
the signup policy, the login page); this mod owns just the *flow* of requesting a
link. Small enough to read in one sitting — it proves the login-method SPI.

```bash
npm install @pattern/mod-auth-magic-link
```

## When to use

Reach for it whenever you want passwordless email sign-in and don't want to build
a provider yourself — or as the worked example to copy when writing your own
(OIDC, SMS…). The flow: `POST /auth/magic-link/request` issues a gated single-use
token, delivery sends the link, and identity's `GET /auth/token?t=…` verifies it
and mints a session. With no delivery subscriber the link **prints to the server
console** — the zero-config dev login.

## Prerequisites

- **`@pattern/mod-identity`** — the kernel this mod plugs into. It registers its
  login method in `ready` (after the identity service exists), so its order in
  `pattern.config.json` doesn't matter.

## Config

Defaults work from the bare config entry:

```jsonc
{ "mods": ["@pattern/mod-identity", "@pattern/mod-auth-magic-link"] }
```

To customize the login-page label or match a non-default identity `mount`, export
a local wrapper mod:

```js
// mods/magic-link.mjs
import { magicLinkMod } from "@pattern/mod-auth-magic-link";
export default magicLinkMod({
  mount: "/auth",                  // must match the identity mod's mount
  label: "Send me a sign-in link", // shown on the login page
});
```

Full documentation: the **Magic-link login** chapter at `/docs` (served by
`@pattern/mod-docs`), or [the source](docs/index.md).
