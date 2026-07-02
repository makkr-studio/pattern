Mint a single-use sign-in link for an existing user and return it as `copy`
(a copyable field), for handing over manually when no email/SMS delivery is
wired. Use it to sign in an *existing* user; for someone new under invite-only
signup, use `identity.users.invite`. Throws if the user is disabled
(re-enable first). Privileged: gate the trigger with the `admin` scope.
