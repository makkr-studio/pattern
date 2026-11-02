The second leg of an OIDC sign-in, wired at `GET <mount>/oidc/<id>/callback`
(register exactly that URL at the IdP). The route feeds it the query's `code`,
`state`, `error` and `error_description`, the request `cookies`, `url` and the
`user-agent` header as `userAgent`. It checks the state cookie written by
`auth.oidc.start`, exchanges the code with the PKCE verifier and the client
secret (resolved from the vault or env at run time), verifies the ID token's
signature, issuer, audience and nonce, then hands the identity to
mod-identity: find-or-create under the current signup policy, mint a session,
set the session cookie, clear the state cookie and redirect to the saved
`next`.

The email claim must be present and `email_verified: true` unless the
provider sets `allowUnverifiedEmail`, because identity links accounts by
email. Every failure redirects to `<mount>/login?error=<code>` with a fixed
code: `oidc-state`, `oidc-exchange`, `oidc-token`, `oidc-no-email`,
`email-not-verified`, `signup-closed`, `account-disabled` or `oidc-failed`.
Text the IdP sends back is only logged. Both legs must derive `redirect_uri`
the same way, so keep `PATTERN_PUBLIC_URL` stable between them.
