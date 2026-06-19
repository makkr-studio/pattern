Report the calling principal — `{ kind: "anonymous" }` when unauthenticated,
else `{ kind: "user", id, email, name, roles, scopes, sessionId }`. Pure and
unprivileged (it only ever sees the caller's own principal), so wire it into
any graph that needs to know who's running; for a host trigger prefer the
`user` port, and reach for this when the answer is needed deeper in the
workflow.
