The sign-in **code** callback: verify a `{ email, code }` pair against the
email's pending code-bearing login tokens, consume the matched token, mint a
session, and redirect to `next` with the cookie set — **in the browsing
context that posted**. An HTTP-shaped op backing `POST /auth/code`.

This is the installed-PWA path. The emailed magic *link* opens in the system
browser — a different cookie jar than a standalone-display app — so the link
signs in the wrong context. The code, typed into the "check your inbox" page
the user already has open, completes the login exactly where they are. The
link and the code share one single-use token: whichever lands first burns
both.

Failure semantics are deliberate: wrong code, unknown email, expired or
burned token all render the same sent page with the same error and status 401
(no account enumeration); comparisons are constant-time; and five wrong
guesses burn the token, link included. Only a **correct** code reaches the
signup-policy / disabled checks — possessing it proves control of the inbox.
