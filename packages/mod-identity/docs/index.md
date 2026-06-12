# Identity

`@pattern/mod-identity` is the identity kernel: users, revocable cookie
sessions, roles→scopes, a single-use token system, the login page, and the
admin's Access screens (Users / Invite / Sessions). Login *methods* are
separate mods that plug into it — `@pattern/mod-auth-magic-link` is the
reference.

```jsonc
{ "mods": ["@pattern/mod-identity", "@pattern/mod-auth-magic-link"] }
```

## First boot

With an empty user store, boot prints a **one-time bootstrap link**
(`/auth/bootstrap?t=…`, valid 24h) — open it, you're the first admin.

## How requests get identities

mod-identity registers an `AuthProvider`: cookie → session lookup → user →
principal with scopes compiled from roles **at resolve time** (edit a role,
every session updates). Triggers gate with `requireAuth` config — `true`,
`{ "scopes": [...] }`, or the env-deferred `{ "env": "MY_SWITCH" }`.

## Tokens & delivery

Magic links print to the **server console** until you register a delivery
workflow on the `identity.deliverToken` hook (an email/SMS workflow — it's
just a hook handler). The console fallback IS the zero-config dev login.
