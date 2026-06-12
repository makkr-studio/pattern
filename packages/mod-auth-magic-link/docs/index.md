# Magic-link login

`@pattern/mod-auth-magic-link` is the reference login method for
mod-identity: `POST /auth/magic-link/request` with `{ email, next? }` issues
a single-use sign-in link and hands it to the `identity.deliverToken` hook
(console fallback in dev). The response is byte-identical whether the address
exists or not — no account enumeration.

Issuance is gated: a token is minted only for a known, enabled user — or an
unknown email when signup is open. The chat and docs apps' sign-in cards post
to this endpoint and ride the `next` parameter straight back after login.
