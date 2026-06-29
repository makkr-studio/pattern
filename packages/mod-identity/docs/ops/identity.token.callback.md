The security heart of login: consume a single-use `login`/`invite` token,
find-or-create the user per the **effective** signup policy, mint a session,
and redirect to `next` with the cookie set. An HTTP-shaped op backing
`GET /auth/token`. Provider mods (magic-link, OIDC) issue tokens whose links
land here; they never mint sessions themselves. Bootstrap tokens are refused
here (they have their own flow), and with a closed signup an unknown email
returns to the login page with an error.
