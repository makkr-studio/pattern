Invite a user by email: mints a 7-day `invite` token (carrying the given
roles) and delivers it via the `identity.deliverToken` hook. Reach for this
when signup is `invite` (the default) and you need to onboard someone who can't
sign themselves up. When no delivery channel is wired the result carries the
link as `copy` (a copyable field) for the admin to hand over manually; `roles`
accepts an array or a comma string. Privileged: gate the trigger with the
`admin` scope.
