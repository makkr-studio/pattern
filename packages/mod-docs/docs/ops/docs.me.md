The docs SPA's first call, at `GET {mount}/api/me`. It returns `user` (`{ id,
name, email }`, or `null` when nobody is signed in), `authRequired` (the
docs policy resolved against the current env), and `login: { kind:
"magic-link", requestPath }` so the app can render its own sign-in card
before it calls any gated route.

This route is always open even when `requireAuth` gates every other docs
route; keep it that way if you fork it, or a gated install can never show
its sign-in card. The policy defaults to `{ env: "DOCS_REQUIRE_AUTH" }`:
unset or false means public docs. Point `loginRequestPath` at a different
endpoint if you sign in some other way. Mirrors `chat.me`.
