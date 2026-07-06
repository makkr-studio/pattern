List every sent invite, newest first, with its derived status — `pending`,
`accepted` (with when and by which resulting user), `expired`, or `revoked` —
plus the roles it grants, the `next` path its first login lands on, and who
sent it. This is the read behind the admin's "Sent invites" table; wire it in
a workflow to build onboarding dashboards or nudge-reminder automations.
Privileged: gate the trigger with the `admin` scope.
