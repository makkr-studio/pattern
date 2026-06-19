Revoke every session of one user — logs them out on all devices and closes
their live WS sockets (code 4001) — without disabling the account, so they can
sign back in immediately. Use it for "sign out everywhere"; to also bar
re-entry use `identity.users.toggleDisabled`. Privileged — gate the trigger
with the `admin` scope.
