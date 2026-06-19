Revoke the current session (from `ctx.principal`'s `sessionId`) and clear the
cookie, then redirect to the login page. Backs `POST /auth/logout` — a POST, so
the CSRF guard makes forged cross-site logouts inert. Anonymous callers just
get the redirect (nothing to revoke).
