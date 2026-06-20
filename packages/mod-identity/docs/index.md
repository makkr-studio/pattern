# Identity

`@pattern-js/mod-identity` is the identity kernel: users, revocable cookie
sessions, roles→scopes, a single-use token system, the login page, and the
admin's Access screens (Users / Invite / Sessions). Login *methods* are
separate mods that plug into it — `@pattern-js/mod-auth-magic-link` is the
reference.

```jsonc
{ "mods": ["@pattern-js/mod-identity", "@pattern-js/mod-auth-magic-link"] }
```

## When to use it

Install it the moment you want **users, sessions, or roles** — a login page,
who-is-this-request, gated routes. It is opt-in: a project without it behaves
exactly as before. But installing it alongside `@pattern-js/mod-admin` **flips the
admin to secure-by-default** — `/admin` (API + SPA) starts requiring the
`admin` scope, and a logged-out browser is 302'd to the login page. Pass
`adminMod({ auth: false })` to keep the admin open anyway. If you only need a
machine-to-machine API key, you don't need this mod; reach for it when a
*human* has to prove who they are.

## Roles → scopes

Users carry **roles** (strings); the `roles` map compiles them into **scopes**
on the principal at **resolve time** — so editing the map applies on the *next*
request, and sessions store no scopes of their own. The default map is
`{ admin: ["admin"] }`. Adding application scopes is *just this map*:

```js
// mods/identity.mjs — a local wrapper mod
import { identityMod } from "@pattern-js/mod-identity";
export default identityMod({
  roles: { admin: ["admin"], editor: ["edit", "read"], viewer: ["read"] },
});
```

Now a user with role `editor` resolves to scopes `["edit","read"]`; gate a
route with `requireAuth: { scopes: ["edit"] }` and both `admin` (if you also
grant it `edit`) and `editor` users get through, `viewer` does not. The same
roles surface on the admin Users screen and are settable there
(`identity.users.setRoles` — which **ends the user's sessions**, because a
privilege change must re-login).

## Bootstrap on first boot

With an empty user store, the mod's `ready` hook mints a one-time **bootstrap
token** (valid 24h) and prints a setup link to the **server console**:

```
[pattern] ◆ No users yet — create the first admin with this one-time link (valid 24h):
[pattern]   http://localhost:3000/auth/bootstrap?t=…
```

Open it: `GET /auth/bootstrap?t=…` renders a form, the `POST` creates the first
user (roles `["admin"]` by default — `bootstrapRoles`) and signs them in. It's
the *same single-use-token primitive* as login and invites, so there's no
special-case admin password anywhere.

## Sessions

Opaque 256-bit secrets in an `HttpOnly; SameSite=Lax` cookie (`pattern_session`
by default); only the sha256 is stored. Sliding 30-day expiry with throttled
touches. Sessions are **revocable** — individually (`identity.sessions.revoke`),
per user (`identity.users.revokeSessions`), and automatically when a role
changes or a user is disabled. Set `cookieSecure: true` behind TLS in
production. CSRF protection lives *inside* the session provider: a cross-site
state-changing request simply doesn't authenticate (so it 401s with no token
machinery), while GETs always pass — the magic-link callback is a cross-site
top-level GET by nature.

## The `user` port

Host-bound triggers (`boundary.http.request`, `boundary.ws.*`) expose a `user`
output port — `{ id, provider, email?, name?, scopes, claims } | null` — so
the caller's identity is an *edge you can see*, not ambient context. Wire it
like any value:

```jsonc
{ "from": { "node": "in", "port": "user" }, "to": { "node": "listNotes", "port": "owner" } }
```

For an op deeper in the graph, `identity.whoami` and `ctx.principal` cover the
same ground.

## Gating a route with `requireAuth`

Enforcement is the **trigger's** job, on its config — core is untouched. Stamp
`requireAuth` on a `boundary.http.request` (or `boundary.ws.*`):

```jsonc
{ "op": "boundary.http.request",
  "config": { "method": "POST", "path": "/api/publish",
              "requireAuth": { "scopes": ["edit"] } } }
```

Forms: `true` (any signed-in user), `{ "scopes": [...] }` (needs all listed
scopes), or the env-deferred `{ "env": "MY_SWITCH" }` (read per request, so you
can flip a surface open/closed without redeploying). The admin's own Access
routes stamp `{ scopes: ["admin"] }` on the boundary; the underlying
`identity.*` ops stay pure and are tagged `sensitivity: "privileged"`, so the
validator flags any route that exposes them without a gate.

## WebSockets

Auth happens **at upgrade** — the same cookie resolves the principal, the
trigger's `requireAuth` is enforced before the socket is accepted, and the
principal is fixed for the connection. Authenticated sockets auto-join two
rooms:

- `user:{id}` — broadcast to all of a user's devices,
- `session:{sessionId}` — **revoking the session closes its sockets** (code 4001).

## Tokens & delivery

Magic links, invites, and the bootstrap link all print to the **server
console** until you register a delivery workflow on the `identity.deliverToken`
hook (`payload: { email, url, purpose, delivered }`) — send the link by
email/SMS/chat and return `delivered: true`. No subscriber (or
`delivered: false`) falls back to the console, which **is** the zero-config dev
login. Tokens are single-use, short-TTL (15 min; invites 7 days), sha256 at
rest, consumed via CAS so replays fail closed. Purposes: `login`, `invite`
(carries roles), `bootstrap`. The `/auth/token` callback turns a consumed token
into a user + session per the **signup policy** — `invite` (default; unknown
emails refused) or `open` — a runtime setting toggled on the admin's Settings
page (the mod option only seeds it).

## Minimal config

Defaults work from the bare `"@pattern-js/mod-identity"` config entry. To
customize, export a local wrapper mod:

```js
// mods/identity.mjs
import { identityMod } from "@pattern-js/mod-identity";
export default identityMod({
  signup: "open",                          // default "invite"
  roles: { admin: ["admin"], editor: ["edit", "read"] },
  cookieSecure: true,                      // REQUIRED behind TLS
  storage: "./.pattern-data/identity.db",  // or "memory"
});
```

`storage` is `node:sqlite` at `./.pattern-data/identity.db` by default —
**gitignored**; never put identity data in `.pattern/`, which is committed
workflow storage.

## Routes

| Route | What |
| --- | --- |
| `GET /auth/login` | Login page (a section per registered method) |
| `GET /auth/token?t=…` | Token callback → session cookie → redirect `next` |
| `POST /auth/logout` | Revoke the current session, clear the cookie |
| `GET /auth/whoami` | The current principal (JSON) |
| `GET /auth/welcome` | Post-login landing when no home is advertised |
| `GET/POST /auth/bootstrap` | First-admin setup (the one-time link) |

All public by design — the privileged surface is ops (`identity.users.*`,
`identity.sessions.*`, `identity.settings.*`), reached through their own
admin-scope-stamped routes under `/admin/api/identity/*`.
