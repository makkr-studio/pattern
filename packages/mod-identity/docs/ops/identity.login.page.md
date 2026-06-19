Render the login page, one section per login method registered by provider mods
(e.g. magic-link) in their `ready` hook — so an identity install with no
provider shows an empty page. An HTTP-shaped op: it emits `{ body, status }`,
not JSON. Backs `GET /auth/login`; you rarely wire it by hand. The `sent` and
`error` query params drive the post-submit and error states.
