Mint a scoped, revocable API token — the bearer credential for the
control-plane surface (the Pattern MCP server, CI deploys, admin API
automation). Returns the raw `pat_…` secret **exactly once**; only its hash is
stored, so copy it from the result immediately.

Scopes are the 0.4.0 taxonomy: `workflows:read`, `workflows:write`,
`runs:read`, `runs:write`, `deploy`, and `admin` (root — satisfies every
requirement, use sparingly). The author-vs-deploy split is the point: a token
that can draft workflows (`workflows:write`) still can't touch what runs in
production without `deploy`.

`ttlDays` is optional — empty means the token lives until revoked. Privileged:
gate the trigger with the `admin` scope.
