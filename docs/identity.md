# Identity: users, sessions, roles & login methods

`@pattern/mod-identity` is the optional identity brick: users, revocable
cookie sessions, roles→scopes, a single-use token kernel, a login page, and
admin screens. `@pattern/mod-auth-magic-link` is the reference login method.
Everything below is opt-in — a project without these mods behaves exactly as
before.

## Quick start

```jsonc
// pattern.config.json
{
  "mods": ["@pattern/mod-identity", "@pattern/mod-auth-magic-link", "@pattern/mod-admin"]
}
```

First boot prints a **one-time bootstrap link**:

```
[pattern] ◆ No users yet — create the first admin with this one-time link (valid 24h):
[pattern]   http://localhost:3000/auth/bootstrap?t=…
```

Open it, enter your email — you're the first admin, signed in. From then on:
`/auth/login` → email → a magic link arrives **in the server console** (until
you wire real delivery, below). That console fallback *is* the dev login:
zero config, same code path as production.

## The two meanings of "auth provider"

- **`AuthProvider`** (core, §9): request → `Principal`. Stateless, chained;
  first non-null wins. mod-identity registers one: cookie → session lookup →
  user → principal with scopes compiled from roles.
- **Login method** (identity SPI): an interactive flow that proves who a
  human is. Provider mods register methods in their `ready` hook via
  `service.registerLoginMethod(…)`; the login page renders a section per
  method. mod-identity bridges the two: a completed login flow mints a
  session, and the session authenticates every later request.

## Sessions

Opaque 256-bit tokens in an `HttpOnly; SameSite=Lax` cookie (`Secure` via the
`cookieSecure` option — enable behind TLS). Only the sha256 lands in storage.
Sliding 30-day expiry with throttled touches; revocable individually or
per-user; **role changes and disabling revoke sessions** (privilege change =
re-login). Storage is `node:sqlite` at `./.pattern-data/identity.db` —
**gitignored**; never put identity data in `.pattern/`, which is committed
workflow storage. All racy writes are CAS (`version` columns), so a future
Postgres driver is the same SQL and multi-instance degrades to CAS-retry.

CSRF protection lives inside the session provider: cross-site state-changing
requests simply don't authenticate (Fetch Metadata, Origin/Host fallback).
GETs always pass — the magic-link callback is a cross-site top-level GET.

## Roles → scopes

Users carry roles; the mod's `roles` map compiles them to scopes on the
principal at **resolve time** (map edits apply on the next request). Default
`{ admin: ["admin"] }`. Trigger `requireAuth: { scopes: [...] }` stays the
enforcement primitive — core is untouched.

## Secure-by-default admin

Installing mod-identity flips `/admin` (API + SPA) to require the `admin`
scope, unless `adminMod({ auth: … })` was set explicitly (`auth: false` keeps
it open). A logged-out browser hitting `/admin` is 302'd to the login page
(any mod can advertise one via core's `AUTH_LOGIN_URL` service key); fetch
calls get bare 401s, which the admin SPA turns into a login redirect. The
admin grows an **Access** section: Users (invite, disable, log-out-everywhere),
Invite, Sessions (revoke) — Tier-1 declarative pages over `identity.*` ops.

## The `user` port

Host-bound triggers (`boundary.http.request`, `boundary.ws.*`) expose a
`user` output port: `{ id, provider, email?, name?, scopes, claims } | null`.
Wire it like any value — user-scoped data is an *edge you can see*, not
ambient context:

```jsonc
{ "from": { "node": "in", "port": "user" }, "to": { "node": "listNotes", "port": "owner" } }
```

`identity.whoami` and `ctx.principal` cover ops that need the caller deeper
in a graph.

## WebSockets

Auth happens **at upgrade**: the same cookie resolves the principal, the
bound triggers' `requireAuth` is enforced before the socket is accepted, and
the principal is fixed for the connection (ws runs execute as it; `user` port
seeded). Authenticated connections auto-join two rooms:

- `user:{id}` — broadcast to all of a user's devices,
- `session:{sessionId}` — **revoking the session closes its sockets** (code 4001).

## Delivering tokens (email, SMS, …)

Token delivery is a hook chain, not a hardcoded channel. Subscribe a workflow
to `identity.deliverToken` (`payload: { email, url, purpose, delivered }`),
send the link however you like, and return the payload with
`delivered: true`. No subscriber (or `delivered: false`) → the link prints to
the console.

## Token kernel

Single-use, short-TTL (15 min; invites 7 days), sha256 at rest, consumed via
CAS — replays fail closed. Purposes: `login` (magic links), `invite` (admin
"Invite" screen; carries roles), `bootstrap` (first boot). The `/auth/token`
callback turns a consumed token into user + session per the **signup
policy**: `invite` (default — unknown emails are refused) or `open`.

## Options

Defaults work from a bare `"@pattern/mod-identity"` entry. To customize, use
a local wrapper mod:

```js
// mods/identity.mjs
import { identityMod } from "@pattern/mod-identity";
export default identityMod({
  signup: "open",                       // default "invite"
  roles: { admin: ["admin"], ops: ["deploy"] },
  cookieSecure: true,                   // REQUIRED behind TLS in production
  storage: "./.pattern-data/identity.db", // or "memory"
  sessionTtlMs: 30 * 24 * 3600 * 1000,
});
```

## Routes

| Route | What |
| --- | --- |
| `GET /auth/login` | Login page (sections from registered methods) |
| `GET /auth/token?t=…` | Token callback → session cookie → redirect `next` |
| `POST /auth/logout` | Revoke current session, clear cookie |
| `GET /auth/whoami` | Current principal (JSON) |
| `GET/POST /auth/bootstrap` | First-admin setup (one-time link) |
| `POST /auth/magic-link/request` | (magic-link mod) issue + deliver a login link |

All public by design — the privileged surface is ops (`identity.users.*`,
`identity.sessions.*`), reached through the admin's stamped invoke path and
guarded **again** in-op (`admin` scope), so an open admin can't leak them.
