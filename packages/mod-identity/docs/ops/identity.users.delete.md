Delete a user for good: their sessions are revoked (live sockets close), then
the user row, identity links and session rows are removed — this is the PII
eraser, not a soft flag (that's `identity.users.toggleDisabled`). Guarded
twice: you can't delete your own account, and never the last active admin.
Audit trails survive on purpose — invites they sent and API tokens they minted
keep the id. Privileged: gate the trigger with the `admin` scope.
