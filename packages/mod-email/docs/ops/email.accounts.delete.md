Remove an email account by `name` (the admin route takes it from the path:
`DELETE /admin/api/email/accounts/:name`). Deleting a name that does not
exist still answers `{ ok: true }`. The vault secrets the account pointed at
stay where they are. Workflows that name the account fail at their next
`email.send` with a "no account configured" error, and `email.account` with
`required: false` starts reporting `configured: false`. Privileged: gate the
trigger with the `admin` scope.
