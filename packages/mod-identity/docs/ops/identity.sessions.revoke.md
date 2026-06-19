Revoke one session by id — it stops resolving on the next request and its live
WS sockets close (code 4001). Use it to kill a single device; for all of a
user's sessions use `identity.users.revokeSessions`. Privileged — gate the
trigger with the `admin` scope.
