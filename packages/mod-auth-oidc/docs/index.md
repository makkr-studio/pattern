# OIDC login

`@pattern-js/mod-auth-oidc` signs users in with any OpenID Connect issuer —
Google, Microsoft, Keycloak, Auth0, Okta… — through `@pattern-js/mod-identity`'s
login-method SPI. Each configured provider becomes a "Continue with …" button
on the login page; several run side by side, next to magic-link. The flow is
the authorization code grant with **PKCE (S256)**, ID tokens verified with
[jose](https://github.com/panva/jose) (signature, issuer, audience, and the
nonce), sessions minted by identity — the same cookie, the same `next`
redirect, the same signup policy as every other login method.

## Configuration is code, on purpose

OIDC wiring is deploy-time, security-critical state: the issuer, the client
id, and the redirect URIs you registered at the IdP. So it lives in a small
**wrapper mod**, not admin CRUD — only the client *secret* is resolved at run
time, from the vault or an env var:

```js
// mods/oidc.mjs — then list "./mods/oidc.mjs" in pattern.config.json
import { oidcMod } from "@pattern-js/mod-auth-oidc";

export default oidcMod({
  providers: [
    {
      id: "google",                       // names the routes + the identity link
      label: "Continue with Google",
      issuer: "https://accounts.google.com",
      clientId: "1234-abc.apps.googleusercontent.com",
      clientSecret: { source: "env", key: "GOOGLE_CLIENT_SECRET" },
    },
  ],
});
```

Register the redirect URI at the IdP as
`https://your-host/auth/oidc/<id>/callback`. Copy-paste issuer/scope snippets
for Google, Microsoft and Keycloak: [the providers guide](guides/providers.md).

## The flow

`GET /auth/oidc/<id>/start` mints state + nonce + a PKCE verifier, stashes
them in a short-lived per-provider HttpOnly cookie, and redirects to the
issuer's authorization endpoint (discovered lazily from
`<issuer>/.well-known/openid-configuration` and cached; an unreachable IdP
never blocks boot). The callback validates state, exchanges the code (verifier
+ client secret), verifies the ID token, then hands the identity to
mod-identity: find-or-create per the effective signup policy → mint session →
set the cookie → redirect to `next`.

Every failure is a redirect to `/auth/login?error=<code>` with a **fixed**
code (`oidc-state`, `oidc-exchange`, `oidc-token`, `email-not-verified`,
`signup-closed`, `account-disabled`, `oidc-failed`) — IdP-supplied text is
only ever logged, never reflected into a URL or page.

## Verified emails only

mod-identity links accounts **by email**: sign in with Google using the same
address as your magic-link account and you are the same user. That linking is
exactly why unverified email claims are rejected by default — an IdP asserting
someone else's address must not take over their account. Only providers whose
tokens carry `email_verified: true` sign in; set `allowUnverifiedEmail: true`
per provider to accept the risk (e.g. a trusted in-house issuer that never
sets the claim).

## Options

| field | | |
|---|---|---|
| `id` | required | url-safe handle; names `/auth/oidc/<id>/…` and the `oidc:<id>` identity link |
| `label` | optional | login-page button text (default `Continue with <id>`) |
| `issuer` | required | the issuer URL (discovery lives under it) |
| `clientId` | required | from the IdP's app registration |
| `clientSecret` | required | `{ source: "vault" \| "env", key }` — a reference, never the value |
| `scopes` | optional | default `["openid", "email", "profile"]` |
| `allowUnverifiedEmail` | optional | default `false` (see above) |

`mount` (top-level, default `"/auth"`) must match the identity mod's mount.
