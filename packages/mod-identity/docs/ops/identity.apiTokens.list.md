List API tokens, newest first — name, scopes, status (active / revoked /
expired), created, last-used and expiry. Secrets are never stored, so nothing
secret can leak from this list: storage only ever holds the sha256 of each
`pat_…` bearer. Privileged: gate the trigger with the `admin` scope.
