# @pattern-js/mod-auth-oidc

OIDC login for [Pattern](../../README.md): "Continue with Google / Microsoft /
Keycloak / any OpenID Connect issuer" buttons on
[`mod-identity`](https://www.npmjs.com/package/@pattern-js/mod-identity)'s
login page. Authorization code flow with PKCE, ID tokens verified with jose,
sessions minted by identity — several providers side by side, and the same
verified email is the same user across OIDC and magic-link.

**Links:** [pattern-js.dev](https://pattern-js.dev) · [npm](https://www.npmjs.com/package/@pattern-js/mod-auth-oidc)

```bash
npm install @pattern-js/mod-identity @pattern-js/mod-auth-oidc
```

## When to use / when not

Reach for it when users should sign in with an account they already have —
Google/Microsoft for consumers and teams, Keycloak/Auth0/Okta for enterprise
SSO. Skip it if passwordless email is enough:
[`mod-auth-magic-link`](https://www.npmjs.com/package/@pattern-js/mod-auth-magic-link)
needs zero IdP setup. They compose — most apps ship both.

## Config

Code-only on purpose (issuer/client id/redirect URIs are deploy-time,
security-critical state); only the client secret resolves at run time, from
the vault or an env var. Export a small wrapper mod and list it:

```js
// mods/oidc.mjs — list "./mods/oidc.mjs" in pattern.config.json
import { oidcMod } from "@pattern-js/mod-auth-oidc";

export default oidcMod({
  providers: [
    {
      id: "google",
      label: "Continue with Google",
      issuer: "https://accounts.google.com",
      clientId: "1234-abc.apps.googleusercontent.com",
      clientSecret: { source: "env", key: "GOOGLE_CLIENT_SECRET" },
    },
    // { id: "microsoft", issuer: "https://login.microsoftonline.com/<tenant>/v2.0", … },
    // { id: "keycloak",  issuer: "https://kc.example.com/realms/<realm>", … },
  ],
});
```

Register `https://your-host/auth/oidc/<id>/callback` as the redirect URI at
the IdP. By default only `email_verified: true` claims sign in (identity links
accounts by email — an unverified claim would be an account-takeover vector);
`allowUnverifiedEmail: true` opts a trusted issuer out.

Full documentation: the **OIDC login** chapter at `/docs` (served by
`@pattern-js/mod-docs`), or [the source](docs/index.md) and
[provider snippets](docs/guides/providers.md).
