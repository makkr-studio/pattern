The first leg of an OIDC sign-in. The mod wires it for you at
`GET <mount>/oidc/<id>/start` (one route per configured provider), and the
login page's "Continue with ..." button points there with `?next=` carrying
the destination. It mints state, nonce and a PKCE S256 verifier, stores them
with the sanitized `next` in a per-provider HttpOnly cookie that lives 10
minutes, and redirects to the issuer's authorization endpoint (discovered
lazily and cached).

Like mod-identity's auth ops it never sees HTTP: it outputs the `body`,
`redirect`, `cookies`, `status` quartet and the route wires those onto
`boundary.http.response`. `config.provider` must name a configured provider
id. The `redirect_uri` is built on `PATTERN_PUBLIC_URL` when set, else on the
request's own origin from `url`; behind a proxy or tunnel set
`PATTERN_PUBLIC_URL`, or the IdP rejects the redirect. Any failure (discovery
down, no origin) redirects to `<mount>/login?error=oidc-failed`. Pairs with
`auth.oidc.callback`.
