Replace a user's roles (the WHOLE set, not a patch), then **revoke all their
sessions**: a privilege change forces a re-login, so don't reach for this on a
hot path expecting the user to stay signed in. New scopes take effect from the
role→scopes map on their next session. Refused when it would demote the last
active admin — an app must always keep someone who can administer it. `roles`
accepts an array or a comma string; privileged: gate the trigger with the
`admin` scope. The admin UI edits this from the user's details page.
