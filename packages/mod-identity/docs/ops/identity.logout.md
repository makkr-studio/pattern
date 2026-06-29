Revoke the current session (from `ctx.principal`'s `sessionId`) and clear the
cookie, then redirect to the login page. Backs `POST /auth/logout`; being a
POST, the CSRF guard makes forged cross-site logouts inert. Anonymous callers
get the redirect (nothing to revoke).
