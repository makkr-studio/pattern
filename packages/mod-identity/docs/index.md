# Identity

`@pattern-js/mod-identity` is the identity kernel: users, revocable cookie
sessions, roles→scopes, a single-use token system, the login page, and the
admin's Access screens (Users / Invite / Sessions). Login *methods* are
separate mods that plug into it. `@pattern-js/mod-auth-magic-link` is the
reference.

```jsonc
{ "mods": ["@pattern-js/mod-identity", "@pattern-js/mod-auth-magic-link"] }
```

## When to use it

Install it the moment you want **users, sessions, or roles**: a login page,
who-is-this-request, gated routes. It is opt-in; a project without it behaves
exactly as before. Installing it alongside `@pattern-js/mod-admin` **flips the
admin to secure-by-default**: `/admin` (API + SPA) starts requiring the
`admin` scope, and a logged-out browser is 302'd to the login page. Pass
`adminMod({ auth: false })` to keep the admin open anyway. For a
machine-to-machine API key, you don't need this mod; reach for it when a
*human* has to prove who they are.

## Roles → scopes

Users carry **roles** (strings); the `roles` map compiles them into **scopes**
on the principal at **resolve time**. Editing the map applies on the *next*
request, and sessions store no scopes of their own. The default map is
`{ admin: ["admin"] }`. Adding application scopes means editing this map:

```js
// mods/identity.mjs (a local wrapper mod)
import { identityMod } from "@pattern-js/mod-identity";
export default identityMod({
  roles: { admin: ["admin"], editor: ["edit", "read"], viewer: ["read"] },
});
```

Now a user with role `editor` resolves to scopes `["edit","read"]`; gate a
route with `requireAuth: { scopes: ["edit"] }` and both `admin` (if you also
grant it `edit`) and `editor` users get through, `viewer` does not. The same
roles surface on the admin Users screen and are settable there
(`identity.users.setRoles`, which **ends the user's sessions**, because a
privilege change must re-login).

## Bootstrap on first boot

With an empty user store, the mod's `ready` hook mints a one-time **bootstrap
token** (valid 24h) and prints a setup link to the **server console**:

```
[pattern] ◆ No users yet. Create the first admin with this one-time link (valid 24h):
[pattern]   http://localhost:3000/auth/bootstrap?t=…
```

Open it: `GET /auth/bootstrap?t=…` renders a form, the `POST` creates the first
user (roles `["admin"]` by default, the `bootstrapRoles` option) and signs them
in. It's the *same single-use-token primitive* as login and invites, so there's
no special-case admin password anywhere.

## Sessions

Opaque 256-bit secrets in an `HttpOnly; SameSite=Lax` cookie (`pattern_session`
by default); only the sha256 is stored. Sliding 30-day expiry with throttled
touches. Sessions are **revocable**: individually (`identity.sessions.revoke`),
per user (`identity.users.revokeSessions`), and automatically when a role
changes or a user is disabled. Set `cookieSecure: true` behind TLS in
production. CSRF protection lives *inside* the session provider: a cross-site
state-changing request doesn't authenticate (so it 401s with no token
machinery), while GETs always pass; the magic-link callback is a cross-site
top-level GET by nature.

## The `user` port

Host-bound triggers (`boundary.http.request`, `boundary.ws.*`) expose a `user`
output port (`{ id, provider, email?, name?, scopes, claims } | null`), so
the caller's identity is an *edge you can see*. Wire it
like any value:

```jsonc
{ "from": { "node": "in", "port": "user" }, "to": { "node": "listNotes", "port": "owner" } }
```

For an op deeper in the graph, `identity.whoami` and `ctx.principal` cover the
same ground.

## Gating a route with `requireAuth`

Enforcement is the **trigger's** job, on its config; core is untouched. Stamp
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

Auth happens **at upgrade**: the same cookie resolves the principal, the
trigger's `requireAuth` is enforced before the socket is accepted, and the
principal is fixed for the connection. Authenticated sockets auto-join two
rooms:

- `user:{id}`: broadcast to all of a user's devices,
- `session:{sessionId}`: **revoking the session closes its sockets** (code 4001).

## Tokens & delivery

Magic links, invites, and the bootstrap link all print to the **server
console** until delivery is wired. The packaged way: install
`@pattern-js/mod-email` + a driver (Resend or SMTP) and create the `default`
account in admin → System → Email — links then send by email automatically.
Any other channel works through the `identity.deliverToken` hook
(`payload: { email, url, purpose, delivered }`): send the link by email/SMS/chat
and return `delivered: true`. No subscriber (or `delivered: false`) falls back
to the console, which **is** the zero-config dev login. Tokens are single-use, short-TTL (15 min; invites 7 days), sha256 at
rest, consumed via CAS so replays fail closed. Purposes: `login`, `invite`
(carries roles), `bootstrap`. The `/auth/token` callback turns a consumed token
into a user + session per the **signup policy**: `invite` (default; unknown
emails refused) or `open`. This is a runtime setting toggled on the admin's
Settings page (the mod option only seeds it).

**Emailed links are absolute.** Set `PATTERN_PUBLIC_URL` (e.g.
`https://app.example.com`) and every delivered link is built on that canonical
origin — it beats the request-derived origin on purpose, because behind a
proxy or tunnel the Host header is whatever the hop put there. Unset (dev),
the request's own origin is used, so localhost links still work with zero
config.

## Invites (0.4)

An invite is a **record**, not just a token: admin → **Access → Invites**
sends one (email, roles, and an optional **next path** — where the invitee's
first login lands, e.g. `/admin` or `/chat`) and lists every invite sent with
its derived status: `pending` → `accepted` (or `expired` / `revoked`). Revoke
a pending invite and its link dies immediately — the callback checks the
record before creating any account.

Accepting an invite deliberately does **not** sign the user in. The link
creates the account, stamps the record, and lands on `/auth/invited` — a small
page that says what just happened and hands over to the login screen with the
invite's next path riding along. Acceptance and the first sign-in stay two
distinct acts, so the invitee consciously picks (and remembers) a sign-in
method.

## Administering users (0.4)

Access → **Users** is the control room: per row — details, a minted sign-in
link, **disable / enable** (reversible lock-out; revokes sessions), **log out
everywhere**, and **delete** (removes the user, their identity links and
session rows; invites and API tokens keep the id as audit trail). Roles are
edited on the user's **details page** (the "Set roles" form replaces the whole
set and ends their sessions). Two guards run everywhere they matter: you can't
disable or delete **yourself**, and the **last active admin** can't be
demoted, disabled or deleted — an app always keeps someone who can administer
it.

## API tokens (0.4)

Sessions authenticate humans in browsers; **API tokens** authenticate
programs — MCP clients on `/mcp/pattern`, CI deploys, scripts against the
admin API. Mint them in admin → **Access → API tokens**: the raw `pat_…`
secret is shown **exactly once** (only its sha256 is stored), and a bearer
header authenticates it on any route:

```
Authorization: Bearer pat_…
```

Tokens are multi-use until revoked (or until their optional expiry), carry
their own **scopes**, and authenticate as themselves — audit trails name the
credential that acted, not the admin who minted it.

| Scope | Grants |
| --- | --- |
| `workflows:read` | read workflows, versions, ops, docs, templates, fixtures |
| `workflows:write` | save drafts, import, write fixtures |
| `runs:read` | read runs, traces, metrics |
| `runs:write` | start, cancel, pause, resume runs |
| `deploy` | deploy, enable/disable, delete — what RUNS |
| `admin` | root — satisfies every requirement (sessions carry this via roles) |

The split that matters: an *authoring* token (`workflows:read` +
`workflows:write`) can draft all day and never change what runs in
production; `deploy` is its own decision. The admin ops re-check these scopes
in-op, so the enforcement holds even when a tool workflow calls them on your
behalf.

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

`storage` is `node:sqlite` at `./.pattern-data/identity.db` by default,
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

All public by design; the privileged surface is ops (`identity.users.*`,
`identity.sessions.*`, `identity.settings.*`), reached through their own
admin-scope-stamped routes under `/admin/api/identity/*`.
