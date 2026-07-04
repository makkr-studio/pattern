Revoke an API token by id: it stops authenticating on the next request.
Idempotent — revoking an already-revoked token succeeds quietly. This is the
kill switch for a leaked or retired credential; there is no un-revoke (mint a
fresh one instead). Privileged: gate the trigger with the `admin` scope.
