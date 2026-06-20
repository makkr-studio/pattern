# @pattern-js/mod-identity

The identity kernel for [Pattern](../../README.md): users, revocable cookie
sessions, roles→scopes, a single-use token system, the login page, and the
admin's Access screens (Users / Invite / Sessions). Login *methods* are separate
mods that plug into it — `@pattern-js/mod-auth-magic-link` is the reference.

```bash
npm install @pattern-js/mod-identity
```

## When to use

Install it the moment you want **users, sessions, or roles** — a login page,
who-is-this-request, gated routes. It's opt-in: a project without it behaves
exactly as before. Installing it alongside `@pattern-js/mod-admin` **flips the admin
to secure-by-default** (`/admin` starts requiring the `admin` scope; pass
`adminMod({ auth: false })` to keep it open). If you only need a machine-to-machine
API key you don't need this mod — reach for it when a *human* must prove who they
are.

## Prerequisites

A login method mod — typically **`@pattern-js/mod-auth-magic-link`**. Identity owns
the kernel; the method owns the sign-in flow.

## Config

Defaults work from the bare config entry:

```jsonc
{ "mods": ["@pattern-js/mod-identity", "@pattern-js/mod-auth-magic-link"] }
```

To customize, export a local wrapper mod:

```js
// mods/identity.mjs
import { identityMod } from "@pattern-js/mod-identity";
export default identityMod({
  signup: "open",                          // default "invite"
  roles: { admin: ["admin"], editor: ["edit", "read"] },
  cookieSecure: true,                      // REQUIRED behind TLS
  storage: "./.pattern-data/identity.db",  // or "memory"; gitignored
});
```

On first boot with an empty store, the `ready` hook prints a one-time bootstrap
link to the server console to create the first admin. Gate routes by stamping
`requireAuth` on a `boundary.http.request` trigger.

Full documentation: the **Identity** chapter at `/docs` (served by
`@pattern-js/mod-docs`), or [the source](docs/index.md).
