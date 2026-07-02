# Provider snippets

Working `providers` entries for the common issuers. In every case, register
the redirect URI `https://your-host/auth/oidc/<id>/callback` in the IdP's app
settings, and put the client secret in the vault (admin → System → Secrets) or
an env var.

## Google

Create an OAuth client (type "Web application") in the
[Google Cloud console](https://console.cloud.google.com/apis/credentials).
Google always sets `email_verified` for Gmail/Workspace accounts.

```js
{
  id: "google",
  label: "Continue with Google",
  issuer: "https://accounts.google.com",
  clientId: "1234-abc.apps.googleusercontent.com",
  clientSecret: { source: "env", key: "GOOGLE_CLIENT_SECRET" },
}
```

## Microsoft (Entra ID)

Register an app under Entra ID → App registrations. The issuer is
**tenant-scoped** — replace `<tenant-id>` with your directory (tenant) id.
(The `common`/`organizations` multi-tenant endpoints vary the token's `iss`
per user, which strict issuer validation rejects — use your tenant id.)

```js
{
  id: "microsoft",
  label: "Continue with Microsoft",
  issuer: "https://login.microsoftonline.com/<tenant-id>/v2.0",
  clientId: "<application-client-id>",
  clientSecret: { source: "vault", key: "MICROSOFT_CLIENT_SECRET" },
}
```

Entra ID doesn't always include `email_verified`; for a tenant you trust,
`allowUnverifiedEmail: true` is the usual escape hatch.

## Keycloak

The issuer is the realm URL. Create a confidential client with the standard
flow enabled.

```js
{
  id: "keycloak",
  label: "Continue with SSO",
  issuer: "https://keycloak.example.com/realms/<realm>",
  clientId: "pattern-app",
  clientSecret: { source: "env", key: "KEYCLOAK_CLIENT_SECRET" },
}
```

Keycloak sets `email_verified` per user — tick "Email verified" (or require
verification) in the realm settings so sign-ins pass the default policy.

## Several at once

`providers` is an array — each entry gets its own button, routes, and
`oidc:<id>` identity link, and the same verified email always resolves to the
same user across all of them (and magic-link):

```js
export default oidcMod({ providers: [google, microsoft, keycloak] });
```
