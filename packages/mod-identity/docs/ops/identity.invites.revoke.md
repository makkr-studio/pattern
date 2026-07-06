Revoke a pending invite: its emailed link stops working immediately — the
token callback checks the invite record before creating any account, so a
consumed-but-revoked link dead-ends on `error=invite-revoked`. Idempotent on
an already-revoked invite; refused once accepted (the account exists — disable
or delete the user instead). Privileged: gate the trigger with the `admin`
scope.
