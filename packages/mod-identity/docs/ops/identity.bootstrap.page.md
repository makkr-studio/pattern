Render the first-admin setup form, reached via the one-time link printed to the
console on first boot when the user store is empty. The GET half of a two-step
flow (this renders, `identity.bootstrap.submit` creates), a deliberate split so
creating the account requires an explicit POST. An HTTP-shaped op backing
`GET /auth/bootstrap`; a missing `t` redirects to login. You never trigger this
manually; boot prints the link.
