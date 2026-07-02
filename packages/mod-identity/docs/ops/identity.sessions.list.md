List sessions newest-first with user email and a derived status
(active/expired/revoked); pass `userId` to scope to one user, omit it for all.
Backs the admin Sessions screen and a user's session sub-list. Privileged: gate
the trigger with the `admin` scope; revoke a row with
`identity.sessions.revoke`.
