Invite a user by email: records the invite (listable via
`identity.invites.list`, revocable while pending), mints its 7-day token and
delivers the link through the `identity.deliverToken` hook. Reach for this
when signup is `invite` (the default) and you need to onboard someone who
can't sign themselves up. `roles` (array or comma string) are granted on
acceptance; `next` sets where their FIRST login lands (e.g. `/admin`,
`/chat`). The emailed link is absolute: `PATTERN_PUBLIC_URL` when set (the
canonical origin — proxies can't lie about it), else the origin of the `url`
input (the admin route wires the request URL in). When no delivery channel is
wired the result carries the link as `copy` for the admin to hand over
manually. Privileged: gate the trigger with the `admin` scope.
