Replace a user's roles, then **revoke all their sessions**: a privilege change
forces a re-login, so don't reach for this on a hot path expecting the user to
stay signed in. New scopes take effect from the role→scopes map on their next
session. `roles` accepts an array or a comma string; privileged: gate the
trigger with the `admin` scope.
